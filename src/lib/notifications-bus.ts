/**
 * In-memory event bus per le notifiche di timbratura in tempo reale.
 *
 * - Pub/sub: ogni client SSE chiama subscribe() e riceve sia gli eventi
 *   recenti (cache) sia i nuovi eventi pubblicati.
 * - Cache ring buffer: gli ultimi MAX_BUFFER eventi, ognuno con TTL di
 *   MAX_AGE_MS, sono mantenuti per consentire a un client che si appena
 *   riconnesso di vedere quel che gli e' sfuggito (per il caso dev/HMR e
 *   per i refresh di pagina).
 * - Effimero: niente DB. Riavvio del processo => buffer azzerato.
 *
 * Singleton globale: in Next.js dev mode il modulo viene re-eseguito al
 * hot reload, quindi il bus viene attaccato a `globalThis` per
 * sopravvivere ai rebuild. In produzione single-process e' un singleton
 * normale; in serverless multi-istanza non funziona, ma il deploy
 * target di questa applicazione e' LAN single-server.
 */

export type NotificationAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END" | "LEAVE_PENDING";

export interface NotificationEvent {
  id: string;          // unique, monotonically increasing
  ts: number;          // epoch ms
  employeeId: string;
  employeeName: string;
  action: NotificationAction;
  time: string;        // HH:MM (locale Europe/Rome) — server-side
  date: string;        // YYYY-MM-DD
}

const MAX_BUFFER = 50;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 ora

type Subscriber = (evt: NotificationEvent) => void;

class NotificationsBus {
  private subscribers = new Map<number, Subscriber>();
  private nextSubId = 1;
  private nextEventId = 1;
  private buffer: NotificationEvent[] = [];

  publish(input: Omit<NotificationEvent, "id" | "ts">): NotificationEvent {
    const evt: NotificationEvent = {
      ...input,
      id: String(this.nextEventId++),
      ts: Date.now(),
    };
    this.buffer.push(evt);
    this.prune();
    for (const cb of this.subscribers.values()) {
      try {
        cb(evt);
      } catch {
        // un subscriber rotto non deve far cadere gli altri
      }
    }
    return evt;
  }

  subscribe(cb: Subscriber): () => void {
    const id = this.nextSubId++;
    this.subscribers.set(id, cb);
    return () => {
      this.subscribers.delete(id);
    };
  }

  /** Eventi recenti ancora dentro il TTL, dal piu' vecchio al piu' nuovo. */
  recent(): NotificationEvent[] {
    this.prune();
    return [...this.buffer];
  }

  private prune() {
    const cutoff = Date.now() - MAX_AGE_MS;
    // rimuovi eventi scaduti
    while (this.buffer.length > 0 && this.buffer[0].ts < cutoff) {
      this.buffer.shift();
    }
    // rimuovi eccesso oltre MAX_BUFFER (mantieni i piu' recenti)
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
  }
}

// Persisti il singleton tra hot-reload in dev
const globalForBus = globalThis as unknown as { __notificationsBus?: NotificationsBus };
export const notificationsBus: NotificationsBus =
  globalForBus.__notificationsBus ?? new NotificationsBus();
if (!globalForBus.__notificationsBus) {
  globalForBus.__notificationsBus = notificationsBus;
}
