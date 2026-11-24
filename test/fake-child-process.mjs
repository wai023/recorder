import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";

export const FAKE = Symbol.for("fuyu-recorder.fake");

export function spawn(command, args) {
  const config = globalThis[FAKE];
  if (!config) throw new Error("fake spawn not configured");

  const proc = {
    exitCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    handlers: {},
    on(event, fn) {
      (this.handlers[event] ||= []).push(fn);
      return this;
    },
    emit(event, value) {
      for (const fn of this.handlers[event] || []) fn(value);
    },
  };

  config.commands = [];
  proc.stdin.setEncoding("utf8");
  proc.stdin.on("data", (text) => {
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      config.commands.push(line);
      if (line.startsWith("START ")) {
        const path = line.slice(6);
        config.startPath = path;
        proc.stdout.write("RECORDING\n");
      } else if (line === "STOP" && config.startPath) {
        writeFileSync(config.startPath, Buffer.from("RIFFfake-wav-data"));
        proc.stdout.write(`SAVED ${config.startPath}\n`);
      } else if (line === "QUIT") {
        proc.exitCode = 0;
        proc.emit("close", 0);
      }
    }
  });

  queueMicrotask(() => {
    if (config.debug) config.debug.push("write READY");
    proc.stdout.write("READY\n");
  });
  config.proc = proc;
  if (config.debug) config.debug.push(`spawned ${command} ${args.join(" ")}`);
  return proc;
}
