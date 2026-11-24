import assert from "node:assert/strict";
import test from "node:test";
import { createLineBuffer, parseReply } from "../src/protocol.ts";

test("parseReply reads the four protocol lines", () => {
  assert.deepEqual(parseReply("READY"), { kind: "ready" });
  assert.deepEqual(parseReply("RECORDING"), { kind: "recording" });
  assert.deepEqual(parseReply("SAVED C:\\tmp\\a.wav"), { kind: "saved", path: "C:\\tmp\\a.wav" });
  assert.deepEqual(parseReply("ERROR device-busy"), { kind: "error", message: "device-busy" });
});

test("parseReply tolerates whitespace and rejects unknown lines", () => {
  assert.deepEqual(parseReply("  READY\r"), { kind: "ready" });
  assert.deepEqual(parseReply("SAVED   C:\\a.wav  "), { kind: "saved", path: "C:\\a.wav" });
  assert.equal(parseReply(""), null);
  assert.equal(parseReply("garbage"), null);
  assert.equal(parseReply("SAVED"), null);
});

test("parseReply keeps an empty ERROR visible instead of dropping it", () => {
  assert.deepEqual(parseReply("ERROR "), { kind: "error", message: "unknown" });
});

test("createLineBuffer splits CRLF lines", () => {
  const seen = [];
  const lines = createLineBuffer((line) => seen.push(line));
  lines.feed("READY\r\nRECORDING\r\nSAVED C:\\a.wav\r\n");
  assert.deepEqual(seen, ["READY", "RECORDING", "SAVED C:\\a.wav"]);
});

test("createLineBuffer holds an incomplete line until the next chunk", () => {
  const seen = [];
  const lines = createLineBuffer((line) => seen.push(line));
  lines.feed("REA");
  assert.deepEqual(seen, []);
  lines.feed("DY\nSAVED C:\\b.wav\n");
  assert.deepEqual(seen, ["READY", "SAVED C:\\b.wav"]);
});

test("createLineBuffer handles a partial path split across chunks", () => {
  const parsed = [];
  const lines = createLineBuffer((line) => {
    const reply = parseReply(line);
    if (reply) parsed.push(reply);
  });
  lines.feed("SAVED C:\\Users\\wai02\\Rec");
  lines.feed("ordings\\r-1.wav\n");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kind, "saved");
  assert.equal(parsed[0].path, "C:\\Users\\wai02\\Recordings\\r-1.wav");
});
