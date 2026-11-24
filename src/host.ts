/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "fuyu-plugin";
import { fileShelfV1, messagesV1 } from "fuyu-plugin/services";
import { createLineBuffer, parseReply } from "./protocol.ts";
import { METHODS, TOPICS, type RecState } from "./types.ts";

export const name = "recorder";
export const inject = {
  clients: null,
  commands: null,
  "file-shelf/v1": null,
  "messages/v1": null,
};

export function apply(ctx: Context) {
  const shelf = ctx.services.get(fileShelfV1);
  const messages = ctx.services.get(messagesV1);

  const scriptPath = join(ctx.dataDir, "record.ps1");
  mkdirSync(ctx.dataDir, { recursive: true });
  const bundledScript = fileURLToPath(new URL("../assets/record.ps1", import.meta.url));
  writeFileSync(scriptPath, readFileSync(bundledScript, "utf8"), "utf8");

  let child: ChildProcessWithoutNullStreams | null = null;
  let pending: ((ok: boolean, payload: string) => void) | null = null;
  let state: RecState = { status: "idle", file: null, error: null, updatedAt: Date.now() };

  const publish = () => ctx.clients.publish(TOPICS.state, state);
  const setState = (patch: Partial<RecState>) => {
    state = { ...state, ...patch, updatedAt: Date.now() };
    publish();
  };

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
        child = null;
        pending?.(false, "recorder-exited");
        pending = null;
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
    if (state.status === "recording" || state.status === "starting") return state;
    setState({ status: "starting", error: null });
    const ready = await ensureChild();
    if (!ready) {
      setState({ status: "error", error: "无法启动 Windows 录音进程" });
      return state;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(ctx.dataDir, `recording-${stamp}.wav`);
    const result = await send(`START ${file}`);
    if (!result.ok || result.payload !== "RECORDING") {
      setState({ status: "error", error: `录音启动失败：${result.payload}` });
      return state;
    }
    setState({ status: "recording", file, error: null });
    return state;
  }

  async function stop(): Promise<RecState> {
    if (state.status !== "recording") return state;
    const result = await send("STOP");
    if (!result.ok || !result.payload.toLowerCase().endsWith(".wav")) {
      setState({ status: "error", error: `停止录音失败：${result.payload}` });
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
    setState({ status: "idle", file: path, error: null });
    return state;
  }

  ctx.clients.handle(METHODS.getState, () => state);
  ctx.clients.handle(METHODS.start, start);
  ctx.clients.handle(METHODS.stop, stop);

  ctx.commands.register("toggle", () => (state.status === "recording" ? stop() : start()), {
    title: { "zh-CN": "开始/停止录音", en: "Start / stop recording" },
  });

  process.on("exit", () => {
    if (child && child.exitCode === null) {
      try { child.stdin.write("QUIT\n", "utf8"); } catch { /* ignore */ }
    }
  });
}
