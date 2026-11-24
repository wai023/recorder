import assert from "node:assert/strict";
import test from "node:test";
import { wavDurationMs } from "../src/wav.ts";

// 拼一个最小 WAV 头：RIFF + fmt(16) + data(size)
function makeWav({ byteRate = 32_000, dataSize = 32_000, channels = 1, bits = 16 } = {}) {
  const fmt = 16;
  const total = 12 + (8 + fmt) + 8 + dataSize;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) buf[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, total - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, fmt, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, byteRate / (channels * (bits / 8)), true); // sample rate
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  return buf;
}

test("wavDurationMs computes from byteRate and data size", () => {
  assert.equal(wavDurationMs(makeWav({ dataSize: 32_000 })), 1000);
  assert.equal(wavDurationMs(makeWav({ dataSize: 16_000 })), 500);
  assert.equal(wavDurationMs(makeWav({ dataSize: 64_000 })), 2000);
});

test("wavDurationMs walks past an extra chunk before data", () => {
  const base = makeWav({ dataSize: 32_000 });
  const extra = new Uint8Array(12); // LIST chunk: id + size(4) + 4 bytes body
  const view = new DataView(extra.buffer);
  for (let i = 0; i < 4; i += 1) extra[i] = "LIST".charCodeAt(i);
  view.setUint32(4, 4, true);
  const merged = new Uint8Array(base.length + extra.length);
  merged.set(base.slice(0, 36), 0);
  merged.set(extra, 36);
  merged.set(base.slice(36), 36 + extra.length);
  // 头部整体挪了位置，RIFF 里的长度不必改，解析只看 data 的大小与 byteRate。
  assert.equal(wavDurationMs(merged), 1000);
});

test("wavDurationMs rejects broken or empty headers", () => {
  assert.equal(wavDurationMs(new Uint8Array(0)), null);
  assert.equal(wavDurationMs(new Uint8Array(44)), null);
  const notRiff = makeWav();
  notRiff[0] = "X".charCodeAt(0);
  assert.equal(wavDurationMs(notRiff), null);
  // data 长度写成 0（有些写入器这么干），交回 null 让调用方按文件大小兜底。
  assert.equal(wavDurationMs(makeWav({ dataSize: 0 })), null);
});
