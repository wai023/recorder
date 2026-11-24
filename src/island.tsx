import type { Context } from "fuyu-plugin";
import { pluginConfigV1 } from "fuyu-plugin/services";
import { useEffect, useState } from "react";
import { METHODS, TOPICS, INITIAL_STATE, formatDuration, type RecState } from "./types.ts";
import { text } from "./text.ts";
import "./styles.css";

const PLUGIN_ID = "@wai023/recorder";
type BarStyle = "icon" | "icon-time" | "text-time";
type BarConfig = { barStyle: BarStyle; showStateDot: boolean };
const DEFAULT_BAR_CONFIG: BarConfig = { barStyle: "icon-time", showStateDot: true };

function MicIcon({ size = 16 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}

function GearIcon({ size = 14 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.4 7 7.2 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function dotClass(state: RecState): string {
  if (state.status === "recording") return "recorder__dot recorder__dot--on";
  if (state.status === "paused") return "recorder__dot recorder__dot--paused";
  if (state.status === "error") return "recorder__dot recorder__dot--error";
  if (state.status === "saved") return "recorder__dot recorder__dot--saved";
  return "recorder__dot";
}

function statusLabel(state: RecState): string {
  if (state.status === "error") {
    const code = state.errorCode ?? "failed";
    const detail = text.errorCode[code];
    return state.error ? `${detail}（${state.error}）` : detail;
  }
  return text.status[state.status];
}

export default function apply(ctx: Context) {
  // 页面与收起条共用同一份宿主快照；时长由宿主每 500ms 推送，窗口不自己计时。
  function useRecorder(): RecState {
    const [state, setState] = useState<RecState>(INITIAL_STATE);

    useEffect(() => {
      const off = ctx.host.on(TOPICS.state, (next: RecState) => setState(next));
      void ctx.host.call(METHODS.getState).then((value) => setState(value as RecState));
      return () => { void off(); };
    }, []);

    return state;
  }

  function useBarConfig(): BarConfig {
    const [config, setConfig] = useState<BarConfig>(DEFAULT_BAR_CONFIG);

    useEffect(() => {
      let off: (() => void) | undefined;
      try {
        const service = ctx.services.get(pluginConfigV1);
        const applyValues = (values: Record<string, unknown> | undefined) => {
          if (!values) return;
          const style = values.barStyle;
          setConfig({
            barStyle: style === "icon" || style === "text-time" ? style : "icon-time",
            showStateDot: values.showStateDot !== false,
          });
        };
        void service.get({ id: PLUGIN_ID }).then((entry) => {
          applyValues(entry?.values as Record<string, unknown> | undefined);
        });
        off = service.on("changed", (event) => {
          if (event.id === PLUGIN_ID) applyValues(event.values as Record<string, unknown>);
        });
      } catch {
        // 配置服务不可用时用默认值，不影响录音本身。
      }
      return () => { off?.(); };
    }, []);

    return config;
  }

  function Page() {
    const state = useRecorder();
    const recording = state.status === "recording";
    const paused = state.status === "paused";
    const active = recording || paused;
    const busy = state.status === "starting";

    return (
      <div className="recorder">
        <p className="recorder__status">
          <span className={dotClass(state)} />
          {statusLabel(state)}
          {active && <span className="recorder__time">{formatDuration(state.elapsedMs)}</span>}
        </p>
        <div className="recorder__actions">
          {!active ? (
            <button
              type="button"
              className="recorder__button"
              disabled={busy}
              onClick={() => void ctx.host.call(METHODS.start)}
            >
              {text.start}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="recorder__button"
                onClick={() => void ctx.host.call(recording ? METHODS.pause : METHODS.resume)}
              >
                {recording ? text.pause : text.resume}
              </button>
              <button
                type="button"
                className="recorder__button recorder__button--stop"
                onClick={() => void ctx.host.call(METHODS.stop)}
              >
                {text.stop}
              </button>
            </>
          )}
          <button
            type="button"
            className="recorder__button recorder__button--settings"
            title={text.settings}
            onClick={() => void ctx.settings.open()}
          >
            {text.settings}
          </button>
        </div>
        {state.status === "saved" && <p className="recorder__note">{text.lastTime}: {formatDuration(state.lastElapsedMs)}</p>}
        {state.status === "error" && <p className="recorder__note recorder__note--warn">{text.error(state.error ?? "")}</p>}
        {state.status === "idle" && <p className="recorder__note">{text.hint}</p>}
      </div>
    );
  }

  function Widget({
    width,
    height,
  }: {
    size: "bar" | "s" | "m" | "l" | "w";
    width: number;
    height: number;
  }) {
    const state = useRecorder();
    const recording = state.status === "recording";
    const paused = state.status === "paused";
    const active = recording || paused;
    const busy = state.status === "starting";
    const wide = width >= 200;
    const tall = height >= 200;
    const showTime = state.status !== "idle";

    return (
      <div className="recorder-widget">
        <div className="recorder-widget__head">
          <span className={dotClass(state)} />
          <span className="recorder-widget__icon"><MicIcon size={16} /></span>
          <span className="recorder-widget__title">{text.title}</span>
        </div>
        <p className="recorder-widget__status">{statusLabel(state)}</p>
        {showTime && <p className="recorder-widget__time">{formatDuration(state.elapsedMs)}</p>}
        <div className="recorder-widget__actions">
          {!active ? (
            <button
              type="button"
              className="recorder-widget__button"
              disabled={busy}
              onClick={() => void ctx.host.call(METHODS.start)}
            >
              {text.shortStart}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="recorder-widget__button"
                onClick={() => void ctx.host.call(recording ? METHODS.pause : METHODS.resume)}
              >
                {recording ? text.shortPause : text.shortResume}
              </button>
              <button
                type="button"
                className="recorder-widget__button recorder-widget__button--stop"
                onClick={() => void ctx.host.call(METHODS.stop)}
              >
                {text.shortStop}
              </button>
            </>
          )}
          {wide && (
            <button
              type="button"
              className="recorder-widget__button recorder-widget__button--settings"
              title={text.settings}
              onClick={() => void ctx.settings.open()}
            >
              {text.settings}
            </button>
          )}
        </div>
        {tall && state.status === "saved" && (
          <p className="recorder-widget__note">{text.lastTime}: {formatDuration(state.lastElapsedMs)}</p>
        )}
      </div>
    );
  }

  function BarItem() {
    const state = useRecorder();
    const config = useBarConfig();
    const recording = state.status === "recording";
    const paused = state.status === "paused";
    const active = recording || paused;
    const showTime = config.barStyle !== "icon" && state.status !== "idle";

    return (
      <div className="recorder-bar" title={statusLabel(state)}>
        {config.showStateDot && <span className={dotClass(state)} />}
        {config.barStyle === "text-time" ? (
          <span className="recorder-bar__label">{text.title}</span>
        ) : (
          <span className="recorder-bar__icon"><MicIcon size={14} /></span>
        )}
        {showTime && <span className="recorder-bar__time">{formatDuration(state.elapsedMs)}</span>}
        {active && (
          <button
            type="button"
            className="recorder-bar__action"
            title={recording ? text.pause : text.resume}
            onClick={(event) => {
              event.stopPropagation();
              void ctx.host.call(recording ? METHODS.pause : METHODS.resume);
            }}
          >
            {recording ? text.pause : text.resume}
          </button>
        )}
        {active && (
          <button
            type="button"
            className="recorder-bar__action recorder-bar__action--stop"
            title={text.stop}
            onClick={(event) => {
              event.stopPropagation();
              void ctx.host.call(METHODS.stop);
            }}
          >
            {text.stop}
          </button>
        )}
        <button
          type="button"
          className="recorder-bar__action recorder-bar__action--settings"
          title={text.settings}
          onClick={(event) => {
            event.stopPropagation();
            void ctx.settings.open();
          }}
        >
          <GearIcon size={13} />
        </button>
      </div>
    );
  }

  ctx.slots.add("island.page/v1", {
    id: "recorder",
    title: { "zh-CN": "录音", en: "Recorder" },
    component: Page,
    icon: MicIcon,
  });

  ctx.slots.add("island.collapsed/v1", {
    id: "recorder-bar",
    label: { "zh-CN": "录音", en: "Recorder" },
    opens: "recorder",
    component: BarItem,
  });

  // 面板组件与官方天气插件一致：同 id、带 bar 档、同步 try/catch 注册。
  // ctx.slots.add 内部走 ctx.effect，旧版浮屿不认这个插槽时会在 effect 里抛错，
  // 由宿主统一处理；这里只兜住同步抛出，页面和收起条不受影响。
  // island.widget/v1 必须直接在 ctx.slots 上调用：add 依赖 this.ctx，
  // 取出来当函数用会丢 this（Cannot read properties of undefined (reading 'ctx')）。
  // 旧版浮屿不认这个插槽时会同步抛错，try/catch 兜住，页面和收起条不受影响。
  try {
    type WidgetSlotItem = { id: string; sizes: string[]; label: unknown; icon: unknown; component: unknown };
    type AddFn = (this: typeof ctx.slots, name: string, item: WidgetSlotItem) => () => void;
    (ctx.slots.add as unknown as AddFn).call(ctx.slots, "island.widget/v1", {
      id: "recorder",
      sizes: ["bar", "s", "m", "l", "w"],
      label: { "zh-CN": "录音", en: "Recorder" },
      icon: MicIcon,
      component: Widget,
    });
  } catch {
    // 旧版浮屿不收第三方组件；页面和收起条仍可用。
  }
}
