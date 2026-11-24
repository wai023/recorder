import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply registers all window methods and the toggle command", () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-"));
  try {
    const ctx = makeCtx(dir);
    host.apply(ctx);
    for (const name of ["recorder.getState", "recorder.start", "recorder.stop"]) {
      assert.ok(ctx.handlers.has(name), `${name} should be registered`);
    }
    assert.ok(ctx.registeredCommands.has("toggle"), "toggle command should be registered");
    const title = ctx.registeredCommands.get("toggle").options.title;
    assert.equal(title["zh-CN"], "开始/停止录音");
    assert.equal(title.en, "Start / stop recording");
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
