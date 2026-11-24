export const TOPICS = {
  state: "recorder.state",
  config: "recorder.config",
} as const;

export const METHODS = {
  getState: "recorder.getState",
  getConfig: "recorder.getConfig",
  start: "recorder.start",
  stop: "recorder.stop",
  pause: "recorder.pause",
  resume: "recorder.resume",
} as const;

export type BarStyle = "icon" | "icon-time" | "text-time";
export type BarConfig = { barStyle: BarStyle; showStateDot: boolean };

export const DEFAULT_BAR_CONFIG: BarConfig = { barStyle: "icon-time", showStateDot: true };

// 配置面板存的是稀疏值（只写改过的项），这里补齐默认并挡掉非法值。
export function normalizeBarConfig(raw: unknown): BarConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const style = input.barStyle;
  return {
    barStyle: style === "icon" || style === "text-time" ? style : "icon-time",
    showStateDot: input.showStateDot !== false,
  };
}

export type RecStatus = "idle" | "starting" | "recording" | "paused" | "saved" | "error";
export type ErrorCode = "permission" | "device" | "interrupted" | "failed" | null;

export type RecState = {
  status: RecStatus;
  file: string | null;
  error: string | null;
  errorCode: ErrorCode;
  // 已完成录音段的累计时长；当前段的实时时长由 startedAt 推导。
  elapsedMs: number;
  // 当前录音段起点；仅在 recording 状态下非 null。
  startedAt: number | null;
  // 上一次录音的时长；结束后 elapsedMs 归零，页面用它显示结果。
  lastElapsedMs: number;
  updatedAt: number;
};

export const INITIAL_STATE: RecState = {
  status: "idle",
  file: null,
  error: null,
  errorCode: null,
  elapsedMs: 0,
  startedAt: null,
  lastElapsedMs: 0,
  updatedAt: 0,
};

// 宿主与界面共用同一个时长算法，避免两处各算一份导致读数漂移。
export function elapsedOf(state: RecState, now: number = Date.now()): number {
  const active = state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
  return state.elapsedMs + active;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
