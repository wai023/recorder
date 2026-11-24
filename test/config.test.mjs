import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BAR_CONFIG, normalizeBarConfig } from "../src/types.ts";

test("normalizeBarConfig fills defaults for an empty config", () => {
  assert.deepEqual(normalizeBarConfig(undefined), DEFAULT_BAR_CONFIG);
  assert.deepEqual(normalizeBarConfig({}), DEFAULT_BAR_CONFIG);
  assert.deepEqual(normalizeBarConfig("nope"), DEFAULT_BAR_CONFIG);
});

test("normalizeBarConfig keeps valid values and rejects unknown ones", () => {
  assert.deepEqual(normalizeBarConfig({ barStyle: "icon", showStateDot: false }), {
    barStyle: "icon",
    showStateDot: false,
    saveDir: "data",
  });
  assert.deepEqual(normalizeBarConfig({ barStyle: "text-time", saveDir: "music" }), {
    barStyle: "text-time",
    showStateDot: true,
    saveDir: "music",
  });
  // 面板里存了不认识的样式时退回默认，不要整块样式失效。
  assert.equal(normalizeBarConfig({ barStyle: "fancy" }).barStyle, "icon-time");
  // 只有显式 false 才关掉状态点，缺省视为开。
  assert.equal(normalizeBarConfig({ showStateDot: "false" }).showStateDot, true);
  // 保存位置只认三档具名目录，其余（含绝对路径）一律回数据目录。
  assert.equal(normalizeBarConfig({ saveDir: "desktop" }).saveDir, "desktop");
  assert.equal(normalizeBarConfig({ saveDir: "documents" }).saveDir, "documents");
  assert.equal(normalizeBarConfig({ saveDir: "C:\\somewhere" }).saveDir, "data");
});
