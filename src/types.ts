export const TOPICS = {
  state: "recorder.state",
} as const;

export const METHODS = {
  getState: "recorder.getState",
  start: "recorder.start",
  stop: "recorder.stop",
} as const;

export type RecState = {
  status: "idle" | "recording" | "starting" | "error";
  file: string | null;
  error: string | null;
  updatedAt: number;
};
