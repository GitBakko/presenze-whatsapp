/**
 * Template di testo per le email automatiche dell'ingest.
 *
 * Tutti i template restituiscono { subject, text, html } pronti per nodemailer.
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
  html: string;
}

/** Risposta a un mittente non riconosciuto (email non in tabella Employee). */
export function replyUnknownSender(originalSubject: string): MailReply {
  const html = renderEmailHtml(
    `<p>Ciao,</p>` +
    `<p>il tuo indirizzo non risulta associato a nessun dipendente registrato. ` +
    `Per inviare richieste di ferie via email, contatta l'amministratore HR ` +
    `e fagli associare il tuo indirizzo email al tuo profilo.</p>`
  );
  return {
    subject: `Re: ${originalSubject || "ferie"} — indirizzo non autorizzato`,
    text:
      "Ciao,\n\n" +
      "il tuo indirizzo non risulta associato a nessun dipendente registrato. " +
      "Per inviare richieste di ferie via email, contatta l'amministratore HR " +
      "e fagli associare il tuo indirizzo email al tuo profilo." +
      FOOTER,
    html,
  };
}

/** Risposta su corpo malformato. */
export function replyParseError(originalSubject: string): MailReply {
  const html = renderEmailHtml(
    `<p>Ciao,</p>` +
    `<p>non sono riuscito a interpretare la tua richiesta di ferie.</p>` +
    `<div style="background-color:#f3f4f5;border-radius:8px;padding:16px;font-family:monospace;font-size:13px;line-height:1.6;margin:16px 0">` +
    `<strong>Formato corretto:</strong><br>` +
    `Oggetto: ferie<br>Corpo:<br>&nbsp;&nbsp;DAL 15/04/2026<br>&nbsp;&nbsp;AL 18/04/2026<br><br>` +
    `Date accettate: GG/MM/AAAA o GG/MM (anno corrente).<br>Solo giornate intere.` +
    `</div>` +
    `<p>Riprova a inviare la richiesta con il formato corretto.</p>`
  );
  return {
    subject: `Re: ${originalSubject || "ferie"} — formato richiesta non valido`,
    text:
      "Ciao,\n\n" +
      "non sono riuscito a interpretare la tua richiesta di ferie.\n\n" +
      FORMATO_ESEMPIO +
      "\n\nRiprova a inviare la richiesta con il formato corretto." +
      FOOTER,
    html,
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
  const html = renderEmailHtml(
    `<p>Ciao <strong>${args.employeeName}</strong>,</p>` +
    `<p>la tua richiesta di ferie è stata acquisita.</p>` +
    `<p><strong>Periodo:</strong> ${period}<br><strong>Stato:</strong> in attesa di approvazione</p>` +
    `<p>Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.</p>` +
    `<p style="margin-top:24px">${renderButton("Vai alla piattaforma", "https://hr.epartner.it/leaves")}</p>`
  );
  return {
    subject: `Re: ${args.originalSubject || "ferie"} — richiesta acquisita`,
    text:
      `Ciao ${args.employeeName},\n\n` +
      `la tua richiesta di ferie è stata acquisita.\n\n` +
      `Periodo: ${period}\n` +
      `Stato: in attesa di approvazione\n\n` +
      `Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.` +
      FOOTER,
    html,
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

  let htmlBody =
    `<p>Ciao <strong>${args.employeeName}</strong>,</p>` +
    `<p>la tua richiesta di ferie ${statusLabel} per il periodo <strong>${period}</strong> ` +
    `è stata cancellata dall'amministratore.</p>`;
  if (args.reason?.trim()) {
    htmlBody += `<p><strong>Motivo:</strong><br>${args.reason.trim()}</p>`;
  }
  if (args.previousStatus === "APPROVED") {
    htmlBody += `<p style="color:#ba1a1a;font-weight:600">ATTENZIONE: queste ferie erano già state approvate. ` +
      `Assicurati di essere al lavoro nei giorni indicati.</p>`;
  }
  htmlBody += `<p style="margin-top:24px">${renderButton("Vai alla piattaforma", "https://hr.epartner.it/leaves")}</p>`;
  const html = renderEmailHtml(htmlBody);

  return {
    subject: "Ferie cancellate",
    text,
    html,
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

  const statusColor = isApproved ? "#1a6b2d" : "#ba1a1a";
  const statusLabel = isApproved ? "APPROVATA" : "RIFIUTATA";
  let htmlBody =
    `<p>Ciao <strong>${args.employeeName}</strong>,</p>` +
    `<p>la tua richiesta di ferie è stata <span style="color:${statusColor};font-weight:700">${statusLabel}</span>.</p>` +
    `<p><strong>Periodo:</strong> ${period}</p>`;
  if (args.notes?.trim()) {
    htmlBody += `<p><strong>Note dell'amministratore:</strong><br>${args.notes.trim()}</p>`;
  }
  htmlBody += `<p style="margin-top:24px">${renderButton("Vai alla piattaforma", "https://hr.epartner.it/leaves")}</p>`;
  const html = renderEmailHtml(htmlBody);

  return { subject, text, html };
}

/** Notifica agli admin quando un dipendente crea una richiesta in PENDING. */
export function newPendingLeaveNotification(args: {
  employeeName: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  notes?: string | null;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  const subject = `Nuova richiesta: ${args.leaveTypeLabel} da ${args.employeeName}`;

  let details = `<strong>Dipendente:</strong> ${args.employeeName}<br>` +
    `<strong>Tipo:</strong> ${args.leaveTypeLabel}<br>` +
    `<strong>Periodo:</strong> ${period}`;
  if (args.hours) details += `<br><strong>Ore:</strong> ${args.hours}`;
  if (args.notes?.trim()) details += `<br><strong>Note:</strong> ${args.notes.trim()}`;

  const text =
    `Nuova richiesta di ${args.leaveTypeLabel} da ${args.employeeName}.\n\n` +
    `Periodo: ${period}` +
    (args.hours ? `\nOre: ${args.hours}` : "") +
    (args.notes?.trim() ? `\nNote: ${args.notes.trim()}` : "") +
    `\n\nAccedi alla piattaforma per approvarla o rifiutarla.` +
    FOOTER;
  const html = renderEmailHtml(
    `<p>Nuova richiesta in attesa di approvazione:</p>` +
    `<p style="background-color:#f3f4f5;border-radius:8px;padding:16px;line-height:1.8">${details}</p>` +
    `<p style="margin-top:24px">${renderButton("Vedi richieste in attesa", "https://hr.epartner.it/leaves")}</p>`
  );
  return { subject, text, html };
}
