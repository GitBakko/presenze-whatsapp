const RECENT_DURATIONS_MAX = 10;

export type WorkerSnapshot = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalCycles: number;
  totalErrors: number;
  recentDurationsMs: number[];
  listening?: boolean;
  clients?: number;
  totalConnections?: number;
};

const _state = new Map<string, WorkerSnapshot>();

function ensureSlot(worker: string): WorkerSnapshot {
  let slot = _state.get(worker);
  if (!slot) {
    slot = {
      running: false,
      startedAt: null,
      lastTickAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      totalCycles: 0,
      totalErrors: 0,
      recentDurationsMs: [],
    };
    _state.set(worker, slot);
  }
  return slot;
}

export function setStartedAt(worker: string): void {
  try {
    ensureSlot(worker).startedAt = new Date().toISOString();
  } catch { /* no-throw */ }
}

export function recordRunning(worker: string, running: boolean): void {
  try {
    ensureSlot(worker).running = running;
  } catch { /* no-throw */ }
}

export function recordTick(
  worker: string,
  args: { ok: boolean; durationMs?: number; errorMessage?: string }
): void {
  try {
    const slot = ensureSlot(worker);
    const now = new Date().toISOString();
    slot.lastTickAt = now;
    slot.totalCycles++;
    if (args.ok) {
      slot.lastSuccessAt = now;
      if (typeof args.durationMs === "number") {
        slot.recentDurationsMs.push(args.durationMs);
        if (slot.recentDurationsMs.length > RECENT_DURATIONS_MAX) {
          slot.recentDurationsMs.shift();
        }
      }
    } else {
      slot.lastErrorAt = now;
      slot.lastErrorMessage = args.errorMessage ?? "unknown";
      slot.totalErrors++;
    }
  } catch { /* no-throw */ }
}

const WS_WORKER = "ws-notifications";

export function recordWsListening(listening: boolean): void {
  try {
    const slot = ensureSlot(WS_WORKER);
    slot.listening = listening;
  } catch { /* no-throw */ }
}

export function recordWsConnection(delta: 1 | -1): void {
  try {
    const slot = ensureSlot(WS_WORKER);
    slot.clients = Math.max(0, (slot.clients ?? 0) + delta);
    if (delta === 1) {
      slot.totalConnections = (slot.totalConnections ?? 0) + 1;
    }
  } catch { /* no-throw */ }
}

export function snapshot(): Record<string, WorkerSnapshot> {
  const out: Record<string, WorkerSnapshot> = {};
  for (const [k, v] of _state.entries()) {
    out[k] = { ...v, recentDurationsMs: [...v.recentDurationsMs] };
  }
  return out;
}

/** @internal test helper */
export function _resetForTest(): void {
  _state.clear();
}
