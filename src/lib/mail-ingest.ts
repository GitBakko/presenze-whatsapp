/**
 * IMAP poller per le richieste ferie via email.
 *
 * Si connette periodicamente alla casella indicata da MAIL_IMAP_*,
 * scarica i messaggi UNREAD nel folder configurato, li elabora UNO per UNO
 * con la pipeline:
 *   1. parsing del Message-ID per dedup (tabella EmailIngestLog)
 *   2. lookup employee per email mittente (case insensitive)
 *      → se non trovato: log + reply "non autorizzato" + UnrecognizedEmail
 *   3. parse del subject (deve essere "ferie", case insensitive)
 *      → se diverso: ignora silenziosamente (non sappiamo se e' una mail
 *        non destinata al sistema)
 *   4. parse del body con parseLeaveDates()
 *      → se fallisce: log + reply errore + non marca come letta? marca
 *        comunque per evitare loop
 *   5. crea LeaveRequest PENDING + reply "richiesta acquisita"
 *   6. marca il messaggio come letto
 *
 * Tutto il flusso e' protetto da try/catch granulari: una mail rotta
 * non blocca le altre.
 *
 * Configurazione via env vars:
 *   MAIL_IMAP_HOST
 *   MAIL_IMAP_PORT       (default 993)
 *   MAIL_IMAP_USER
 *   MAIL_IMAP_PASSWORD
 *   MAIL_IMAP_TLS        ("true" default; "false" => plain)
 *   MAIL_IMAP_FOLDER     (default INBOX)
 *   MAIL_POLL_INTERVAL_SEC  (default 120)
 *
 * Singleton: il poller viene avviato una sola volta a server start
 * via instrumentation.ts. Se le env IMAP non sono configurate, il
 * poller fa no-op silenzioso.
 */

import { ImapFlow } from "imapflow";
import { createHash } from "crypto";
import { prisma } from "./db";
import { parseLeaveDates } from "./leave-date-parser";
import { sendMail } from "./mail-send";
import {
  replyUnknownSender,
  replyParseError,
  replyRequestAccepted,
} from "./mail-templates";

const MAX_PER_CYCLE = 50;

interface IngestStats {
  scanned: number;
  ok: number;
  unknownSender: number;
  parseError: number;
  duplicate: number;
  internalError: number;
}

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

export function isMailIngestConfigured(): boolean {
  return !!(
    process.env.MAIL_IMAP_HOST &&
    process.env.MAIL_IMAP_USER &&
    process.env.MAIL_IMAP_PASSWORD
  );
}

/** Avvia il poller. Idempotente: chiamare piu' volte non duplica i timer. */
export function ensureMailPollerStarted() {
  if (_running) return;
  if (!isMailIngestConfigured()) {
    console.log("[mail-ingest] IMAP non configurato, poller disattivato");
    return;
  }
  _running = true;
  console.log("[mail-ingest] poller avviato");
  scheduleNext(0);
}

export function stopMailPoller() {
  _running = false;
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function scheduleNext(delayMs: number) {
  if (!_running) return;
  _timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      console.error("[mail-ingest] cycle error:", err);
    }
    const intervalSec = parseInt(process.env.MAIL_POLL_INTERVAL_SEC || "120", 10);
    scheduleNext(intervalSec * 1000);
  }, delayMs);
}

/**
 * Esegue un singolo ciclo di polling. Esportata per poterla invocare
 * manualmente da una API admin (es. "Aggiorna ora") o per i test.
 */
export async function runOnce(): Promise<IngestStats> {
  const stats: IngestStats = {
    scanned: 0,
    ok: 0,
    unknownSender: 0,
    parseError: 0,
    duplicate: 0,
    internalError: 0,
  };
  if (!isMailIngestConfigured()) return stats;

  const host = process.env.MAIL_IMAP_HOST!;
  const port = parseInt(process.env.MAIL_IMAP_PORT || "993", 10);
  const user = process.env.MAIL_IMAP_USER!;
  const pass = process.env.MAIL_IMAP_PASSWORD!;
  const tls = (process.env.MAIL_IMAP_TLS || "true").toLowerCase() !== "false";
  const folder = process.env.MAIL_IMAP_FOLDER || "INBOX";

  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      // Cerca i messaggi non letti
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return stats;

      // Cap di sicurezza
      const targets = uids.slice(0, MAX_PER_CYCLE);

      for (const uid of targets) {
        stats.scanned++;
        try {
          await processOne(client, uid, stats);
        } catch (err) {
          stats.internalError++;
          console.error("[mail-ingest] processOne failed for uid", uid, err);
          // marca come letto comunque per evitare loop infinito su una
          // mail problematica
          try {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          } catch {
            // ignore
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  console.log("[mail-ingest] cycle done:", stats);
  return stats;
}

async function processOne(client: ImapFlow, uid: number, stats: IngestStats) {
  // Scarica headers + body
  const fetched = await client.fetchOne(
    String(uid),
    { source: true, envelope: true, bodyStructure: true },
    { uid: true }
  );
  if (!fetched) return;

  const envelope = fetched.envelope;
  const messageId = envelope?.messageId || `imap-${uid}`;
  const subject = envelope?.subject || "";
  const fromAddr = envelope?.from?.[0]?.address?.toLowerCase() || "";
  const fromName = envelope?.from?.[0]?.name || "";

  // 1. Filtro subject. Solo "ferie" (case insensitive, eventualmente
  //    preceduto da "Re:"/"Fwd:" che ignoriamo).
  const subjectClean = subject
    .replace(/^(?:re:|fwd?:|r:)\s*/gi, "")
    .trim()
    .toLowerCase();
  if (subjectClean !== "ferie") {
    // Non e' destinata a noi. Lasciamo non letta? No, marchiamola letta
    // per evitare di rilavorarla ad ogni ciclo. L'utente puo' sempre
    // rimetterla unread se vuole.
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  // 2. Idempotency: gia' processata?
  const existingLog = await prisma.emailIngestLog.findUnique({
    where: { messageId },
  });
  if (existingLog) {
    stats.duplicate++;
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  // 3. Estrai il body testuale dal source RFC822
  const source = fetched.source;
  if (!source) {
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", "source vuoto", null);
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }
  const body = extractPlainBody(source);

  // 4. Lookup employee per mittente
  if (!fromAddr) {
    await logIngest(messageId, "", subject, "PARSE_ERROR", "mittente vuoto", null);
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  const employee = await prisma.employee.findUnique({ where: { email: fromAddr } });
  if (!employee) {
    stats.unknownSender++;
    await logIngest(messageId, fromAddr, subject, "UNKNOWN_SENDER", null, null);
    const unkId = unrecognizedKey(fromAddr);
    await prisma.unrecognizedEmail.upsert({
      where: { id: unkId },
      create: {
        id: unkId,
        fromAddress: fromAddr,
        subject,
        snippet: body.slice(0, 200),
      },
      update: {
        receivedAt: new Date(),
        attempts: { increment: 1 },
        snippet: body.slice(0, 200),
      },
    });
    // Reply
    const reply = replyUnknownSender(subject);
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      inReplyTo: messageId,
      references: messageId,
    });
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  // 5. Parse delle date dal corpo
  const parsed = parseLeaveDates(body);
  if (!parsed) {
    stats.parseError++;
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", "DAL/AL non riconosciuti", null);
    const reply = replyParseError(subject);
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      inReplyTo: messageId,
      references: messageId,
    });
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  // 6. Crea la LeaveRequest PENDING
  if (parsed.startDate > parsed.endDate) {
    stats.parseError++;
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", "endDate < startDate", null);
    const reply = replyParseError(subject);
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      inReplyTo: messageId,
      references: messageId,
    });
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return;
  }

  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      type: "VACATION",
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      status: "PENDING",
      source: "EXTERNAL_API",
      notes: `Richiesta via email da ${fromAddr}` + (fromName ? ` (${fromName})` : ""),
    },
  });

  stats.ok++;
  await logIngest(messageId, fromAddr, subject, "OK", null, leave.id);

  // 7. Reply di conferma
  const reply = replyRequestAccepted({
    originalSubject: subject,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    employeeName: employee.displayName || employee.name,
  });
  await sendMail({
    to: fromAddr,
    subject: reply.subject,
    text: reply.text,
    inReplyTo: messageId,
    references: messageId,
  });

  // 8. Marca come letta
  await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
}

// ── Helpers ──────────────────────────────────────────────────────────

async function logIngest(
  messageId: string,
  fromAddress: string,
  subject: string,
  status: string,
  errorDetail: string | null,
  leaveRequestId: string | null
) {
  try {
    await prisma.emailIngestLog.upsert({
      where: { messageId },
      create: {
        messageId,
        fromAddress,
        subject,
        status,
        errorDetail,
        leaveRequestId,
      },
      update: {}, // gia' loggata, no-op
    });
  } catch (err) {
    console.error("[mail-ingest] logIngest failed:", err);
  }
}

/** Hash deterministico del fromAddress per usarlo come `id` stabile
 *  della UnrecognizedEmail (un solo record per indirizzo, upsert per
 *  address). 24 char alphanumerici. */
function unrecognizedKey(fromAddress: string): string {
  return "unk-" + createHash("sha256").update(fromAddress).digest("hex").slice(0, 24);
}

/** Estrae il body text/plain da un messaggio RFC822 grezzo.
 *  Supporto best-effort: niente parser MIME completo. Per i casi piu'
 *  comuni (text/plain singolo, multipart/alternative con text/plain
 *  parte) funziona; per HTML-only fa fallback strip dei tag. */
export function extractPlainBody(source: Buffer | Uint8Array): string {
  const text = Buffer.from(source).toString("utf-8");

  // Trova la separazione header/body (prima riga vuota)
  const sepIdx = text.indexOf("\r\n\r\n");
  const idx = sepIdx >= 0 ? sepIdx + 4 : text.indexOf("\n\n") + 2;
  if (idx < 2) return text;

  const headers = text.slice(0, idx);
  const body = text.slice(idx);

  // Cerca Content-Type negli header
  const ctMatch = headers.match(/content-type:\s*([^;\r\n]+)(.*)/i);
  const ct = (ctMatch?.[1] || "text/plain").toLowerCase().trim();
  const params = ctMatch?.[2] || "";

  if (ct === "text/plain") {
    return decodeBody(body, headers);
  }
  if (ct === "text/html") {
    return stripHtml(decodeBody(body, headers));
  }
  if (ct.startsWith("multipart/")) {
    const boundaryMatch = params.match(/boundary=["']?([^"';\s]+)["']?/i);
    if (!boundaryMatch) return stripHtml(body);
    const boundary = "--" + boundaryMatch[1];
    const parts = body.split(boundary).filter((p) => p.trim() && !p.startsWith("--"));
    // Cerca prima la parte text/plain
    for (const part of parts) {
      const partHeadEnd = part.indexOf("\r\n\r\n");
      if (partHeadEnd < 0) continue;
      const partHead = part.slice(0, partHeadEnd);
      const partBody = part.slice(partHeadEnd + 4);
      if (/content-type:\s*text\/plain/i.test(partHead)) {
        return decodeBody(partBody, partHead).trim();
      }
    }
    // Fallback: prima parte text/html stripped
    for (const part of parts) {
      const partHeadEnd = part.indexOf("\r\n\r\n");
      if (partHeadEnd < 0) continue;
      const partHead = part.slice(0, partHeadEnd);
      const partBody = part.slice(partHeadEnd + 4);
      if (/content-type:\s*text\/html/i.test(partHead)) {
        return stripHtml(decodeBody(partBody, partHead)).trim();
      }
    }
  }

  return stripHtml(body);
}

function decodeBody(body: string, headers: string): string {
  const cteMatch = headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i);
  const cte = (cteMatch?.[1] || "7bit").toLowerCase().trim();
  if (cte === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (cte === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8");
    } catch {
      return body;
    }
  }
  return body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
