type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultLevel(): Level {
  const env = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

let currentLevel: Level = defaultLevel();

/** @internal test helper */
export function _setLogLevelForTest(level: Level): void {
  currentLevel = level;
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);
      }
      return value;
    });
  } catch {
    return JSON.stringify({ note: "unserializable", value: String(obj) });
  }
}

function emit(level: Level, meta: Record<string, unknown>, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return;
  const record = { ts: new Date().toISOString(), level, msg, ...meta };
  const line = safeStringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (meta: Record<string, unknown>, msg: string) => emit("debug", meta, msg),
  info: (meta: Record<string, unknown>, msg: string) => emit("info", meta, msg),
  warn: (meta: Record<string, unknown>, msg: string) => emit("warn", meta, msg),
  error: (meta: Record<string, unknown>, msg: string) => emit("error", meta, msg),
};
