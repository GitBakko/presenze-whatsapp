/** Tipi condivisi tra endpoint /api/stats/dashboard e componenti dashboard. */

// ── KPI singolo con delta vs periodo precedente ──────────────────────

export interface KpiValue {
  value: number;
  delta: number; // differenza vs periodo precedente (positivo = crescita)
}

// ── Response completa dell'endpoint ──────────────────────────────────

export interface DashboardStatsResponse {
  period: "today" | "month" | "quarter";
  generatedAt: string; // ISO timestamp

  // Se oggi è un giorno non lavorativo (weekend o festività)
  isNonWorkingToday: boolean;
  nonWorkingLabel: string | null; // "Sabato", "Domenica", "Pasqua", ecc.

  // Sezione A — Riepilogo Oggi (sempre relativo a oggi)
  today: {
    totalEmployees: number;
    presenti: number;
    assenti: number;
    ferie: number;
    malattia: number;
    anomalieAperte: number;
  };

  // Sezione B — KPI del periodo selezionato
  kpi: {
    tassoPresenza: KpiValue;       // %
    tassoPuntualita: KpiValue;     // %
    ritardoMedioMin: KpiValue;     // minuti
    tassoAssenteismo: KpiValue;    // %
    oreStraordTotali: KpiValue;    // ore
    oreLavorateMediaDip: KpiValue; // ore
    giorniMalattia: KpiValue;      // giorni
    percAnomalieRisolte: KpiValue; // %
  };

  // Sezione C — Grafici (restituiti solo se richiesti via ?chart=)
  charts?: {
    oreMensili?: OreChartPoint[];
    assenzeTipologia?: AssenzaChartPoint[];
    ritardoPerDipendente?: EmployeeMetricPoint[];
    straordinarioPerDipendente?: EmployeeMetricPoint[];
  };

  // Sezione D — Dipendenti oggi
  employeesToday: EmployeeTodayStatus[];

  // Sezione D — Anomalie recenti (ultime 4 non risolte)
  anomalieRecenti: AnomalyRecent[];

  // Sezione E — Saldi ferie & ROL per tutti i dipendenti
  leaveBalances: LeaveBalanceRow[];
}

// ── Sezione C: punti grafico ─────────────────────────────────────────

export interface OreChartPoint {
  mese: string;       // abbreviazione italiana ("Gen", "Feb", ...)
  contratto: number;  // ore contratto
  lavorate: number;   // ore effettivamente lavorate
}

export interface AssenzaChartPoint {
  tipo: string;       // "Ferie", "Malattia", "ROL", "Permessi", "Altro"
  giorni: number;
  colore: string;     // hex
}

export interface EmployeeMetricPoint {
  employeeName: string;
  totalMinutes: number;   // totale nel periodo (minuti)
  avgMinutes: number;     // media per giorno lavorato (minuti)
  days: number;           // giorni con il dato (ritardi o straordinari)
}

// ── Sezione D: stato dipendenti oggi ─────────────────────────────────

export type EmployeeStatus = "present" | "late" | "absent" | "sick" | "vacation" | "nonWorking";

export interface EmployeeTodayStatus {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: EmployeeStatus;
  entryTime: string | null;   // HH:MM o null se assente
  delayMinutes: number;       // 0 se puntuale
  label: string | null;       // "Malattia", "Ferie", null
}

// ── Sezione D: anomalie recenti ──────────────────────────────────────

export interface AnomalyRecent {
  id: string;
  employeeName: string;
  type: string;
  description: string;
  date: string;        // YYYY-MM-DD
  severity: number;    // 2=strutturale, 1=warning, 0=possibile
}

// ── Sezione E: saldi ferie/ROL ───────────────────────────────────────

export interface LeaveBalanceRow {
  employeeId: string;
  employeeName: string;
  avatarUrl: string | null;
  vacationUsed: number;
  vacationTotal: number;     // carryOver + accrued + adjust
  vacationRemaining: number;
  vacationPercent: number;   // usato / totale × 100
  rolRemaining: number;      // ore
  alert: boolean;            // true se < 5 gg residui e siamo in H2
}

// ── Props componenti ─────────────────────────────────────────────────

export type DashboardPeriod = "today" | "month" | "quarter";

export interface StatCardProps {
  label: string;
  value: string;
  delta: number;
  deltaInverted?: boolean; // true = delta negativo è buono (ritardo, assenteismo)
  color: "green" | "blue" | "amber" | "red" | "gray";
  barPercent?: number;     // 0-100 per la barra in basso
}
