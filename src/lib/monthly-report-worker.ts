import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { monthlyReportEmail } from "./mail-templates";
import { buildPresenzeMonthData, generatePresenzeXlsx, presenzeFilename } from "./excel-presenze";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MESI_LABEL = [
  "", "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _retryScheduled = false;

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function generateAndSend(): Promise<number> {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const monthLabel = `${MESI_LABEL[prevMonth]} ${prevYear}`;
  const filename = presenzeFilename(prevYear, prevMonth);

  console.log(`[monthly-report] Generating report for ${monthLabel}...`);

  const data = await buildPresenzeMonthData(prevYear, prevMonth);
  const buf = await generatePresenzeXlsx(data);
  const base64 = Buffer.from(buf).toString("base64");

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", active: true, receiveMonthlyReport: true },
    select: { email: true, name: true },
  });

  const template = monthlyReportEmail({ monthLabel, filename });
  let sentCount = 0;

  for (const admin of admins) {
    if (!admin.email) continue;
    try {
      const ok = await sendMail({
        to: admin.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        attachments: [{
          filename,
          contentBytes: base64,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }],
      });
      if (ok) sentCount++;
      else console.warn(`[monthly-report] sendMail returned false for ${admin.email}`);
    } catch (err) {
      console.error(`[monthly-report] sendMail failed for ${admin.email}:`, err);
    }
  }

  console.log(`[monthly-report] Sent ${monthLabel} report to ${sentCount}/${admins.length} admins`);
  return sentCount;
}

async function runCheck(): Promise<void> {
  try {
    const enabled = await getSetting("monthlyReportEnabled");
    if (enabled === "false") return;

    const dayStr = await getSetting("monthlyReportDay");
    const day = dayStr ? parseInt(dayStr, 10) : 5;
    const now = new Date();

    if (now.getDate() !== day) return;

    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastSent = await getSetting("lastReportSent");
    if (lastSent === currentYearMonth) return;

    await generateAndSend();
    await setSetting("lastReportSent", currentYearMonth);
    _retryScheduled = false;
  } catch (err) {
    console.error("[monthly-report] runCheck failed:", err);
    if (!_retryScheduled) {
      _retryScheduled = true;
      console.log("[monthly-report] Scheduling retry in 1 hour");
      setTimeout(() => {
        _retryScheduled = false;
        void runCheck().then(() => {
          const now = new Date();
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          return setSetting("lastReportSent", ym);
        }).catch((e) => console.error("[monthly-report] retry also failed:", e));
      }, CHECK_INTERVAL_MS);
    }
  }
}

function scheduleNext(delayMs: number): void {
  _timer = setTimeout(async () => {
    await runCheck();
    scheduleNext(CHECK_INTERVAL_MS);
  }, delayMs);
  if (_timer && typeof _timer === "object" && "unref" in _timer) {
    (_timer as NodeJS.Timeout).unref();
  }
}

export function ensureMonthlyReportWorkerStarted(): void {
  if (_running) return;
  _running = true;
  console.log("[monthly-report] Worker started (check every 1h)");
  scheduleNext(5000);
}

/** Manual trigger — used by the "Send now" API. */
export async function triggerMonthlyReportNow(): Promise<number> {
  return generateAndSend();
}
