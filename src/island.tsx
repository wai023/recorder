import type { Context } from "fuyu-plugin";
import { useEffect, useState } from "react";
import { METHODS, TOPICS, type RecState } from "./types.ts";
import { text } from "./text.ts";
import "./styles.css";

const INITIAL: RecState = { status: "idle", file: null, error: null, updatedAt: 0 };

function MicIcon({ size = 16 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}

export default function apply(ctx: Context) {
  function Page() {
    const [state, setState] = useState<RecState>(INITIAL);

    useEffect(() => {
      const off = ctx.host.on(TOPICS.state, (next: RecState) => setState(next));
      void ctx.host.call(METHODS.getState).then((value) => setState(value as RecState));
      return () => { void off(); };
    }, []);

    const busy = state.status === "starting";
    const recording = state.status === "recording";
    const label = busy ? text.starting : recording ? text.recording : state.error ? text.error(state.error) : text.idle;
    const fileName = state.file ? state.file.split(/[\\/]/).pop() : "";

    return (
      <div className="recorder">
        <p className="recorder__status">
          <span className={recording ? "recorder__dot recorder__dot--on" : "recorder__dot"} />
          {label}
        </p>
        <button
          type="button"
          className={`recorder__button${recording ? " recorder__button--stop" : ""}`}
          disabled={busy}
          onClick={() => void ctx.host.call(recording ? METHODS.stop : METHODS.start)}
        >
          {recording ? text.stop : text.start}
        </button>
        {fileName && <p className="recorder__note">{text.saved}: {fileName}</p>}
        {state.status === "idle" && !state.error && <p className="recorder__note">{text.hint}</p>}
      </div>
    );
  }

  ctx.slots.add("island.page/v1", {
    id: "recorder",
    title: { "zh-CN": "录音", en: "Recorder" },
    component: Page,
    icon: MicIcon,
  });
}
