import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const FAKE = Symbol.for("fuyu-recorder.fake");
const source = readFileSync(resolve("build/package/dist/host.js"), "utf8");
const fakeUrl = pathToFileURL(resolve("test/fake-child-process.mjs")).href;
const patched = source.replace('from "node:child_process"', `from "${fakeUrl}"`);
if (patched === source) throw new Error("failed to patch spawn import");
const tmpRoot = mkdtempSync(join(tmpdir(), "fuyu-recorder-module-"));
mkdirSync(join(tmpRoot, "dist"), { recursive: true });
mkdirSync(join(tmpRoot, "assets"), { recursive: true });
writeFileSync(join(tmpRoot, "assets/record.ps1"), readFileSync(resolve("build/package/assets/record.ps1"), "utf8"));
const tmpModule = join(tmpRoot, "dist/host.e2e.mjs");
writeFileSync(tmpModule, patched, "utf8");
const host = await import(pathToFileURL(tmpModule).href);

function makeCtx(dataDir, sink) {
  const handlers = new Map();
  return {
    dataDir,
    clients: {
      handle: (name, fn) => handlers.set(name, fn),
      publish: (topic, data) => sink.published.push({ topic, data }),
    },
    services: {
      get: () => ({
        add: (params) => sink.shelfAdded.push(...params.paths),
        notify: (notice) => sink.notices.push(notice),
      }),
    },
    commands: { register: (id, fn) => sink.commands.set(id, fn) },
    setInterval: () => ({ dispose() {} }),
    handlers,
  };
}

test("full start -> recording -> stop cycle saves a WAV and notifies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-e2e-"));
  const sink = { published: [], shelfAdded: [], notices: [], commands: new Map() };
  const config = { commands: [], proc: null, startPath: null };
  globalThis[FAKE] = config;

  try {
    const ctx = makeCtx(dir, sink);
    host.apply(ctx);

    const started = await ctx.handlers.get("recorder.start")();
    assert.equal(started.status, "recording", "start should reach recording state");
    assert.ok(started.file.endsWith(".wav"));
    assert.deepEqual(config.commands[0].split(" ")[0], "START");

    const stopped = await ctx.handlers.get("recorder.stop")();
    assert.equal(stopped.status, "saved", "stop should reach the saved state");
    assert.equal(stopped.elapsedMs, 0, "elapsed time should reset to zero after saving");
    assert.ok(stopped.lastElapsedMs >= 0, "last duration should be kept for the page");
    assert.equal(stopped.file, started.file);
    assert.ok(existsSync(started.file), "WAV file should exist on disk");
    assert.deepEqual(config.commands[1], "STOP");

    assert.deepEqual(sink.shelfAdded, [started.file], "file should be added to the shelf");
    assert.equal(sink.notices.length, 1, "one notification should be sent");
    assert.equal(sink.notices[0].title, "录音已保存");

    const statuses = sink.published.map((p) => p.data.status);
    assert.deepEqual(statuses, ["starting", "recording", "saved"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis[FAKE] = null;
  }
});

test("toggle command starts and stops", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-e2e-"));
  const sink = { published: [], shelfAdded: [], notices: [], commands: new Map() };
  const config = { commands: [], proc: null, startPath: null };
  globalThis[FAKE] = config;

  try {
    const ctx = makeCtx(dir, sink);
    host.apply(ctx);
    await sink.commands.get("toggle")();
    assert.equal(ctx.handlers.get("recorder.getState")().status, "recording");
    await sink.commands.get("toggle")();
    assert.equal(ctx.handlers.get("recorder.getState")().status, "saved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis[FAKE] = null;
  }
});

test("full start -> pause -> resume -> stop cycle keeps elapsed time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fuyu-recorder-e2e-"));
  const sink = { published: [], shelfAdded: [], notices: [], commands: new Map() };
  const config = { commands: [], proc: null, startPath: null };
  globalThis[FAKE] = config;

  try {
    const ctx = makeCtx(dir, sink);
    host.apply(ctx);

    const started = await ctx.handlers.get("recorder.start")();
    assert.equal(started.status, "recording");
    assert.equal(started.elapsedMs, 0);
    assert.ok(started.startedAt !== null, "recording should have a segment start");

    const paused = await ctx.handlers.get("recorder.pause")();
    assert.equal(paused.status, "paused");
    assert.equal(paused.startedAt, null, "pausing should freeze the current segment");
    const frozen = paused.elapsedMs;

    const resumed = await ctx.handlers.get("recorder.resume")();
    assert.equal(resumed.status, "recording");
    assert.equal(resumed.elapsedMs, frozen, "resuming should not reset accumulated time");
    assert.ok(resumed.startedAt !== null, "resuming should open a new segment");

    const stopped = await ctx.handlers.get("recorder.stop")();
    assert.equal(stopped.status, "saved");
    assert.equal(stopped.startedAt, null);
    assert.equal(stopped.elapsedMs, 0, "current time should be zero after saving");
    assert.ok(stopped.lastElapsedMs >= frozen, "final duration should be kept in lastElapsedMs");
    assert.ok(existsSync(started.file), "WAV file should exist on disk");
    assert.deepEqual(sink.shelfAdded, [started.file], "file should be added to the shelf");

    assert.equal(config.commands[1], "PAUSE");
    assert.equal(config.commands[2], "RESUME");
    assert.equal(config.commands[3], "STOP");

    const statuses = sink.published.map((p) => p.data.status);
    assert.deepEqual(statuses, ["starting", "recording", "paused", "recording", "saved"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis[FAKE] = null;
  }
});
