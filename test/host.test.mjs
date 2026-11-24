import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const host = await import("../build/package/dist/host.js");

function makeCtx(dataDir) {
  const handlers = new Map();
  const commands = new Map();
  const published = [];
  return {
    dataDir,
    clients: {
      handle: (name, fn) => handlers.set(name, fn),
      publish: (topic, data) => published.push({ topic, data }),
    },
    services: {
      get: () => ({
        add: () => {},
        notify: () => ({ shown: true, receivedAt: Date.now() }),
      }),
    },
    commands: {
      register: (id, fn, options) => commands.set(id, { fn, options }),
    },
    setInterval: () => ({ dispose() {} }),
    handlers,
    registeredCommands: commands,
    published,
  };
}

test("apply copies the bundled PowerShell script into the data directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const copied = join(dir, "record.ps1");
    assert.ok(existsSync(copied), "record.ps1 should be copied");
    const content = readFileSync(copied, "utf8");
    assert.ok(content.includes("mciSendString"), "script should contain the MCI call");
    assert.ok(content.includes("RECORDING"), "script should contain the RECORDING reply");
    assert.ok(content.includes("PAUSED"), "script should contain the PAUSED reply");
    assert.ok(content.includes("RESUMED"), "script should contain the RESUMED reply");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply registers all window methods and both commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    for (const name of [
      "recorder.getState",
      "recorder.getConfig",
      "recorder.start",
      "recorder.stop",
      "recorder.pause",
      "recorder.resume",
      "recorder.list",
      "recorder.reveal",
    ]) {
      assert.ok(ctx.handlers.has(name), `${name} should be registered`);
    }
    assert.ok(ctx.registeredCommands.has("toggle"), "toggle command should be registered");
    assert.ok(ctx.registeredCommands.has("pause"), "pause command should be registered");
    const title = ctx.registeredCommands.get("toggle").options.title;
    assert.equal(title["zh-CN"], "开始/停止录音");
    assert.equal(title.en, "Start / stop recording");
    const pauseTitle = ctx.registeredCommands.get("pause").options.title;
    assert.equal(pauseTitle["zh-CN"], "暂停/继续录音");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getConfig publishes defaults on start and answers the window", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const config = ctx.handlers.get("recorder.getConfig")();
    assert.deepEqual(config, { barStyle: "icon-time", showStateDot: true, saveDir: "data" });
    const publishedConfig = ctx.published.find((item) => item.topic === "recorder.config");
    assert.ok(publishedConfig, "config should be published for the island");
    assert.deepEqual(publishedConfig.data, { barStyle: "icon-time", showStateDot: true, saveDir: "data" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getConfig reads the saved config.json from the data directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ barStyle: "icon", showStateDot: false }), "utf8");
    const ctx = makeCtx(dir);
    host.apply(ctx);
    assert.deepEqual(ctx.handlers.get("recorder.getConfig")(), { barStyle: "icon", showStateDot: false, saveDir: "data" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getState reports idle before any recording starts", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const state = ctx.handlers.get("recorder.getState")();
    assert.equal(state.status, "idle");
    assert.equal(state.file, null);
    assert.equal(state.error, null);
    assert.equal(state.errorCode, null);
    assert.equal(state.elapsedMs, 0);
    assert.equal(state.startedAt, null);
    assert.equal(state.lastElapsedMs, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stop before start is a no-op and does not publish", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const before = ctx.published.length;
    const state = await ctx.handlers.get("recorder.stop")();
    assert.equal(state.status, "idle");
    assert.equal(ctx.published.length, before, "no state change should be published");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("module metadata matches the manifest", () => {
  assert.equal(host.name, "recorder");
  assert.deepEqual(host.inject.clients, null);
  assert.deepEqual(host.inject.commands, null);
  assert.ok("file-shelf/v1" in host.inject);
  assert.ok("messages/v1" in host.inject);
});

// 44 字节 WAV 头，data 长度只写进头里，文件不必真有那么多数据。
function wavHeader(dataSize, byteRate = 32_000) {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

test("list returns recordings newest first with durations", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const older = join(dir, "recording-old.wav");
    const newer = join(dir, "recording-new.wav");
    writeFileSync(older, wavHeader(16_000)); // 500ms
    writeFileSync(newer, wavHeader(32_000)); // 1000ms
    utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
    utimesSync(newer, new Date(2026, 0, 2), new Date(2026, 0, 2));

    const list = ctx.handlers.get("recorder.list")();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "recording-new.wav");
    assert.equal(list[0].durationMs, 1000);
    assert.equal(list[1].durationMs, 500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reveal refuses anything that is not a wav inside the recording folders", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    const reveal = ctx.handlers.get("recorder.reveal");
    assert.equal(reveal(join(dir, "notes.txt")).ok, false); // 扩展名不对
    assert.equal(reveal(join(tmpdir(), "elsewhere.wav")).ok, false); // 目录越界
    assert.equal(reveal(join(dir, "missing.wav")).ok, false); // 文件不存在
    assert.equal(reveal(42).ok, false); // 类型不对
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
