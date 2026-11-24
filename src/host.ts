/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "fuyu-plugin";
import { fileShelfV1, messagesV1 } from "fuyu-plugin/services";
import { createLineBuffer, parseReply } from "./protocol.ts";
import { METHODS, TOPICS, INITIAL_STATE, elapsedOf, type ErrorCode, type RecState } from "./types.ts";

export const name = "recorder";
export const inject = {
  clients: null,
  commands: null,
  "file-shelf/v1": null,
  "messages/v1": null,
};

// 宽松分类：宁可归到 failed，也不要误报成权限问题。
function classifyError(message: string): ErrorCode {
  const text = message.toLowerCase();
  if (/permission|denied|access|privacy|隐私|权限/.test(text)) return "permission";
  if (/device|not found|no driver|2953|设备/.test(text)) return "device";
  if (/interrupt|exited|recorder-exited|closed|中断/.test(text)) return "interrupted";
  return "failed";
}

export function apply(ctx: Context) {
  const shelf = ctx.services.get(fileShelfV1);
  const messages = ctx.services.get(messagesV1);

  const scriptPath = join(ctx.dataDir, "record.ps1");
  mkdirSync(ctx.dataDir, { recursive: true });
  const bundledScript = fileURLToPath(new URL("../assets/record.ps1", import.meta.url));
  writeFileSync(scriptPath, readFileSync(bundledScript, "utf8"), "utf8");

  let child: ChildProcessWithoutNullStreams | null = null;
  let pending: ((ok: boolean, payload: string) => void) | null = null;
  let state: RecState = { ...INITIAL_STATE, updatedAt: Date.now() };

  // state 内部只存「已完成段累计 + 当前段起点」，对外快照把实时时长算进 elapsedMs。
  const snapshot = (): RecState => ({ ...state, elapsedMs: elapsedOf(state) });
  const publish = () => ctx.clients.publish(TOPICS.state, snapshot());
  const setState = (patch: Partial<RecState>) => {
    state = { ...state, ...patch, updatedAt: Date.now() };
    publish();
  };

  // 结算当前段：读的是调用前的 state，必须在任何 setState 之前取值。
  function settleCurrent(): number {
    const active = state.startedAt === null ? 0 : Math.max(0, Date.now() - state.startedAt);
    return state.elapsedMs + active;
  }

  function fail(message: string, code?: ErrorCode) {
    setState({
      status: "error",
      error: message,
      errorCode: code ?? classifyError(message),
      elapsedMs: 0,
      startedAt: null,
      lastElapsedMs: settleCurrent(),
    });
  }

  function handleLine(raw: string) {
    const reply = parseReply(raw);
    if (!reply) return;
    if (reply.kind === "saved" || reply.kind === "error") {
      pending?.(reply.kind === "saved", reply.kind === "saved" ? reply.path : reply.message);
    } else {
      pending?.(true, reply.kind.toUpperCase());
    }
    pending = null;
  }

  function handleUnexpectedClose() {
    child = null;
    pending?.(false, "recorder-exited");
    pending = null;
    if (state.status !== "recording" && state.status !== "paused") return;

    const elapsed = settleCurrent();
    const file = state.file;
    const saved = file !== null && existsSync(file);
    if (saved && file) {
      shelf.add({ paths: [file] });
      messages.notify({
        source: "recorder",
        pluginId: name,
        title: "录音已中断，文件已保存",
        body: file,
        durationMs: 6000,
      });
    }
    setState({
      status: "error",
      error: saved ? "录音被中断，已保存已录部分" : "录音被中断，文件未保存",
      errorCode: "interrupted",
      elapsedMs: 0,
      startedAt: null,
      lastElapsedMs: elapsed,
    });
  }

  function ensureChild(): Promise<boolean> {
    if (child && child.exitCode === null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-SampleRate", "16000"],
        { windowsHide: true },
      );
      child = proc;
      const lines = createLineBuffer(handleLine);
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => lines.feed(chunk));
      proc.stderr.on("data", () => {});
      proc.on("error", () => {
        child = null;
        pending?.(false, "powershell-failed");
        pending = null;
        resolve(false);
      });
      proc.on("close", () => {
        handleUnexpectedClose();
      });
      pending = (ok) => resolve(ok);
    });
  }

  function send(command: string): Promise<{ ok: boolean; payload: string }> {
    return new Promise((resolve) => {
      if (!child || child.exitCode !== null) {
        resolve({ ok: false, payload: "not-ready" });
        return;
      }
      pending = (ok, payload) => resolve({ ok, payload });
      child.stdin.write(`${command}\n`, "utf8");
    });
  }

  async function start(): Promise<RecState> {
    if (state.status === "recording" || state.status === "starting" || state.status === "paused") return state;
    setState({
      status: "starting",
      error: null,
      errorCode: null,
      elapsedMs: 0,
      startedAt: null,
      lastElapsedMs: 0,
      file: null,
    });
    const ready = await ensureChild();
    if (!ready) {
      fail("无法启动 Windows 录音进程", "device");
      return state;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(ctx.dataDir, `recording-${stamp}.wav`);
    const result = await send(`START ${file}`);
    if (!result.ok || result.payload !== "RECORDING") {
      fail(`录音启动失败：${result.payload}`);
      return state;
    }
    setState({ status: "recording", file, error: null, errorCode: null, startedAt: Date.now() });
    return state;
  }

  async function pause(): Promise<RecState> {
    if (state.status !== "recording") return state;
    const result = await send("PAUSE");
    if (!result.ok || result.payload !== "PAUSED") {
      fail(`暂停失败：${result.payload}`);
      return state;
    }
    setState({ status: "paused", elapsedMs: settleCurrent(), startedAt: null, error: null, errorCode: null });
    return state;
  }

  async function resume(): Promise<RecState> {
    if (state.status !== "paused") return state;
    const result = await send("RESUME");
    if (!result.ok || result.payload !== "RESUMED") {
      fail(`继续录音失败：${result.payload}`);
      return state;
    }
    setState({ status: "recording", startedAt: Date.now(), error: null, errorCode: null });
    return state;
  }

  async function stop(): Promise<RecState> {
    if (state.status !== "recording" && state.status !== "paused") return state;
    const elapsed = settleCurrent();
    const result = await send("STOP");
    if (!result.ok || !result.payload.toLowerCase().endsWith(".wav")) {
      setState({
        status: "error",
        error: `停止录音失败：${result.payload}`,
        errorCode: classifyError(result.payload),
        elapsedMs: 0,
        startedAt: null,
        lastElapsedMs: elapsed,
      });
      return state;
    }
    const path = result.payload;
    if (existsSync(path)) {
      shelf.add({ paths: [path] });
      messages.notify({
        source: "recorder",
        pluginId: name,
        title: "录音已保存",
        body: path,
        durationMs: 6000,
      });
    }
    setState({
      status: "saved",
      file: path,
      error: null,
      errorCode: null,
      // 结束后当前时长归零，最后时长单独留给页面显示，收起条不再挂着旧读数。
      elapsedMs: 0,
      startedAt: null,
      lastElapsedMs: elapsed,
    });
    return state;
  }

  ctx.clients.handle(METHODS.getState, () => snapshot());

  // 录音中每 500ms 推一次实时时长；停止后不再推送，窗口只读快照。
  ctx.setInterval(() => {
    if (state.status === "recording") publish();
  }, 500);
  ctx.clients.handle(METHODS.start, start);
  ctx.clients.handle(METHODS.stop, stop);
  ctx.clients.handle(METHODS.pause, pause);
  ctx.clients.handle(METHODS.resume, resume);

  ctx.commands.register("toggle", () => (state.status === "recording" || state.status === "paused" ? stop() : start()), {
    title: { "zh-CN": "开始/停止录音", en: "Start / stop recording" },
  });

  ctx.commands.register(
    "pause",
    () => (state.status === "recording" ? pause() : state.status === "paused" ? resume() : Promise.resolve(state)),
    { title: { "zh-CN": "暂停/继续录音", en: "Pause / resume recording" } },
  );

  process.on("exit", () => {
    if (child && child.exitCode === null) {
      try { child.stdin.write("QUIT\n", "utf8"); } catch { /* ignore */ }
    }
  });
}
