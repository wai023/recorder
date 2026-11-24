export type Reply =
  | { kind: "ready" }
  | { kind: "recording" }
  | { kind: "paused" }
  | { kind: "resumed" }
  | { kind: "saved"; path: string }
  | { kind: "error"; message: string };

export function parseReply(raw: string): Reply | null {
  const line = raw.trim();
  if (!line) return null;
  if (line === "READY") return { kind: "ready" };
  if (line === "RECORDING") return { kind: "recording" };
  if (line === "PAUSED") return { kind: "paused" };
  if (line === "RESUMED") return { kind: "resumed" };
  if (line.startsWith("SAVED ")) {
    const path = line.slice(6).trim();
    return path ? { kind: "saved", path } : null;
  }
  if (line === "ERROR") return { kind: "error", message: "unknown" };
  if (line.startsWith("ERROR ")) {
    const message = line.slice(6).trim();
    return message ? { kind: "error", message } : { kind: "error", message: "unknown" };
  }
  return null;
}

export function createLineBuffer(onLine: (line: string) => void) {
  let buffer = "";
  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    },
  };
}
