import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { monthlyReportEmail } from "./mail-templates";
import { buildPresenzeMonthData, generatePresenzeXlsx, presenzeFilename } from "./excel-presenze";
import { flattenIssues } from "./presenze/issues";
import { shouldWarnPreSend } from "./presenze/pre-send-warning";
import { notificationsBus } from "./notifications-bus";
import { logger } from "./logger";
import { recordRunning, recordTick, setStartedAt } from "./worker-metrics";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const WORKER = "monthly-report";
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

  logger.info({ worker: WORKER, monthLabel }, "generating report");

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
      else logger.warn({ worker: WORKER, to: admin.email }, "sendMail returned false");
    } catch (err) {
      logger.error({ worker: WORKER, to: admin.email, err: String(err) }, "sendMail failed");
    }
  }

  logger.info({ worker: WORKER, monthLabel, sentCount, totalAdmins: admins.length }, "report sent");
  return sentCount;
}

async function runCheck(): Promise<void> {
  const started = Date.now();
  try {
    const enabled = await getSetting("monthlyReportEnabled");
    if (enabled === "false") {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    const dayStr = await getSetting("monthlyReportDay");
    const day = dayStr ? parseInt(dayStr, 10) : 5;
    const now = new Date();

    // Pre-send heads-up: a few days before reportDay, warn if red issues remain.
    const WARN_LEAD_DAYS = 2;
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const reportMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const lastSentForWarn = await getSetting("lastReportSent");
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    try {
      const monthData = await buildPresenzeMonthData(prevYear, prevMonth);
      const reviewEmployees = monthData.employees.map((emp) => {
        const days = [];
        const nDays = new Date(prevYear, prevMonth, 0).getDate();
        for (let d = 1; d <= nDays; d++) {
          const c = emp.classifications.get(d);
          if (c) days.push(c);
        }
        return { employeeId: emp.employeeId, name: emp.displayName, displayName: emp.displayName, days, overtimeTotal: emp.straordinari };
      });
      const redIssueCount = flattenIssues(reviewEmployees).filter((i) => i.severity === "red").length;
      if (
        shouldWarnPreSend({
          today: now.getDate(),
          reportDay: day,
          warnLeadDays: WARN_LEAD_DAYS,
          alreadySent: lastSentForWarn === currentYM,
          redIssueCount,
        })
      ) {
        const warnedKey = `presenzeReviewWarned-${reportMonthStr}`;
        if ((await getSetting(warnedKey)) !== "true") {
          notificationsBus.publish({
            employeeId: "",
            employeeName: "Revisione Presenze",
            action: "ANOMALY_RESOLVED",
            time: "",
            date: `${reportMonthStr}-01`,
            details: { recordType: "PRESENZE_REVIEW_WARNING" },
          });
          await setSetting(warnedKey, "true");
          logger.warn({ worker: WORKER, reportMonthStr, redIssueCount }, "pre-send heads-up: red issues remain");
        }
      }
    } catch (err) {
      logger.error({ worker: WORKER, err: String(err) }, "pre-send heads-up check failed");
    }

    if (now.getDate() !== day) {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastSent = await getSetting("lastReportSent");
    if (lastSent === currentYearMonth) {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    await generateAndSend();
    await setSetting("lastReportSent", currentYearMonth);
    _retryScheduled = false;
    recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
  } catch (err) {
    logger.error({ worker: WORKER, err: String(err) }, "runCheck failed");
    recordTick(WORKER, {
      ok: false,
      durationMs: Date.now() - started,
      errorMessage: String(err),
    });
    if (!_retryScheduled) {
      _retryScheduled = true;
      logger.info({ worker: WORKER }, "scheduling retry in 1 hour");
      setTimeout(() => {
        _retryScheduled = false;
        void runCheck().then(() => {
          const now = new Date();
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          return setSetting("lastReportSent", ym);
        }).catch((e) =>
          logger.error({ worker: WORKER, err: String(e) }, "retry also failed")
        );
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
  setStartedAt(WORKER);
  recordRunning(WORKER, true);
  logger.info({ worker: WORKER, intervalMs: CHECK_INTERVAL_MS }, "worker started");
  scheduleNext(5000);
}

/** Manual trigger — used by the "Send now" API. */
export async function triggerMonthlyReportNow(): Promise<number> {
  return generateAndSend();
}
