/**
 * Template di testo per le email automatiche dell'ingest.
 *
 * Tutti i template sono solo plain text — niente HTML — per massima
 * compatibilita' con client mail eterogenei e per evitare di sembrare
 * spam.
 *
 * Le funzioni restituiscono { subject, text } pronti per nodemailer.
 */

import { formatItDate } from "./leave-date-parser";
import { readFileSync } from "fs";
import { join } from "path";

// Base64-encode logo for inline email use (emails can't fetch local URLs)
let logoBase64: string;
try {
  const svg = readFileSync(join(process.cwd(), "public/logo.svg"), "utf-8");
  logoBase64 = Buffer.from(svg).toString("base64");
} catch {
  logoBase64 = "";
}

export function renderButton(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background-color:#004253;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;mso-padding-alt:0;text-align:center">${label}</a>`;
}

export function renderEmailHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:Arial,Helvetica,sans-serif;color:#191c1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f9fa">
  <tr><td align="center" style="padding:32px 16px 0">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#004253;border-radius:12px 12px 0 0;padding:20px 32px;text-align:left">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${logoBase64 ? `<td style="padding-right:12px"><img src="data:image/svg+xml;base64,${logoBase64}" alt="ePartner HR" width="32" height="32" style="display:block"></td>` : ""}
          <td style="color:#ffffff;font-size:20px;font-weight:700;line-height:1.2">ePartner HR</td>
        </tr></table>
      </td></tr>
    </table>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#ffffff;padding:32px;font-size:14px;line-height:1.6;color:#191c1d">
        ${body}
      </td></tr>
    </table>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#f8f9fa;border-top:1px solid #e1e3e4;padding:20px 32px;text-align:center;font-size:12px;color:#6f797c;line-height:1.5">
        ePartner HR &mdash; Questa &egrave; un'email automatica, non rispondere.<br>
        <a href="https://hr.epartner.it" style="color:#004253;text-decoration:underline">hr.epartner.it</a>
      </td></tr>
    </table>
    <div style="height:32px"></div>
  </td></tr>
</table>
</body>
</html>`;
}

const FOOTER = "\n\n— HR Presenze\nQuesta è un'email automatica, non rispondere.";

const FORMATO_ESEMPIO = `Formato corretto:
  Oggetto: ferie
  Corpo:
    DAL 15/04/2026
    AL 18/04/2026

Date accettate: GG/MM/AAAA o GG/MM (anno corrente).
Solo giornate intere.`;

export interface MailReply {
  subject: string;
  text: string;
}

/** Risposta a un mittente non riconosciuto (email non in tabella Employee). */
export function replyUnknownSender(originalSubject: string): MailReply {
  return {
    subject: `Re: ${originalSubject || "ferie"} — indirizzo non autorizzato`,
    text:
      "Ciao,\n\n" +
      "il tuo indirizzo non risulta associato a nessun dipendente registrato. " +
      "Per inviare richieste di ferie via email, contatta l'amministratore HR " +
      "e fagli associare il tuo indirizzo email al tuo profilo." +
      FOOTER,
  };
}

/** Risposta su corpo malformato. */
export function replyParseError(originalSubject: string): MailReply {
  return {
    subject: `Re: ${originalSubject || "ferie"} — formato richiesta non valido`,
    text:
      "Ciao,\n\n" +
      "non sono riuscito a interpretare la tua richiesta di ferie.\n\n" +
      FORMATO_ESEMPIO +
      "\n\nRiprova a inviare la richiesta con il formato corretto." +
      FOOTER,
  };
}

/** Risposta di conferma quando la richiesta e' stata accettata in PENDING. */
export function replyRequestAccepted(args: {
  originalSubject: string;
  startDate: string;
  endDate: string;
  employeeName: string;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  return {
    subject: `Re: ${args.originalSubject || "ferie"} — richiesta acquisita`,
    text:
      `Ciao ${args.employeeName},\n\n` +
      `la tua richiesta di ferie è stata acquisita.\n\n` +
      `Periodo: ${period}\n` +
      `Stato: in attesa di approvazione\n\n` +
      `Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.` +
      FOOTER,
  };
}

/**
 * Notifica al dipendente quando un admin cancella una richiesta
 * esistente (indipendentemente dallo status precedente: PENDING,
 * APPROVED, REJECTED).
 */
export function leaveCancellationNotification(args: {
  previousStatus: "PENDING" | "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  employeeName: string;
  reason?: string | null;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;

  const statusLabel =
    args.previousStatus === "APPROVED"
      ? "già approvata"
      : args.previousStatus === "PENDING"
      ? "in attesa di approvazione"
      : "rifiutata";

  let text =
    `Ciao ${args.employeeName},\n\n` +
    `la tua richiesta di ferie ${statusLabel} per il periodo ${period} ` +
    `è stata cancellata dall'amministratore.\n`;
  if (args.reason && args.reason.trim()) {
    text += `\nMotivo:\n${args.reason.trim()}\n`;
  }
  if (args.previousStatus === "APPROVED") {
    text +=
      `\nATTENZIONE: queste ferie erano già state approvate. ` +
      `Assicurati di essere al lavoro nei giorni indicati.\n`;
  }
  text += FOOTER;

  return {
    subject: "Ferie cancellate",
    text,
  };
}

/** Notifica al dipendente quando un admin approva o rifiuta una richiesta. */
export function leaveDecisionNotification(args: {
  status: "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  employeeName: string;
  notes?: string | null;
}): MailReply {
  const isApproved = args.status === "APPROVED";
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  const subject = isApproved
    ? "Ferie approvate"
    : "Ferie rifiutate";
  const verb = isApproved ? "approvata" : "rifiutata";

  let text = `Ciao ${args.employeeName},\n\n` +
    `la tua richiesta di ferie è stata ${verb}.\n\n` +
    `Periodo: ${period}\n`;
  if (args.notes && args.notes.trim()) {
    text += `\nNote dell'amministratore:\n${args.notes.trim()}\n`;
  }
  text += FOOTER;

  return { subject, text };
}
