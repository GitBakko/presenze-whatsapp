const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

interface LeaveFormatInput {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MESI[parseInt(m, 10) - 1]}`;
}

function stripLeadingZero(time: string): string {
  return time.replace(/^0(\d)/, "$1");
}

function formatTimeRange(timeSlots: string): string | null {
  try {
    const slots = JSON.parse(timeSlots) as { from: string; to: string }[];
    if (!slots.length) return null;
    const s = slots[0];
    return `dalle ${stripLeadingZero(s.from)} alle ${stripLeadingZero(s.to)}`;
  } catch {
    return null;
  }
}

export function formatLeaveDetail(
  leave: LeaveFormatInput,
  context: "today" | "upcoming",
  today: string
): string {
  const { type, startDate, endDate, timeSlots } = leave;

  if (context === "today") {
    if (type === "VACATION_HALF_AM") return "mattina";
    if (type === "VACATION_HALF_PM") return "pomeriggio";
    if (timeSlots) {
      const range = formatTimeRange(timeSlots);
      if (range) return range;
    }
    if (startDate === endDate && startDate === today) return "solo oggi";
    if (endDate > today) return `fino al ${formatDate(endDate)}`;
    return "oggi";
  }

  const datePrefix =
    startDate === endDate
      ? `il ${formatDate(startDate)}`
      : `dal ${formatDate(startDate)} al ${formatDate(endDate)}`;

  if (type === "VACATION_HALF_AM") return `${datePrefix}, mattina`;
  if (type === "VACATION_HALF_PM") return `${datePrefix}, pomeriggio`;
  if (timeSlots) {
    const range = formatTimeRange(timeSlots);
    if (range) return `il ${formatDate(startDate)}, ${range}`;
  }
  return datePrefix;
}
