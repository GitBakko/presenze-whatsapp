"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, ChevronLeft, CalendarClock, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import { todayRome } from "@/lib/tz";
import { PlanByEmployee, type PlanEmployee, type PlanDay, type PlanExclusion } from "./_components/PlanByEmployee";

export default function AmortizationPage() {
  const confirm = useConfirm();
  const { lastEvent } = useNotificationsContext();
  const [employees, setEmployees] = useState<PlanEmployee[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [currentMonthLabel, setCurrentMonthLabel] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState("");

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leaves/predictor/plan");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees ?? []);
        setMonths(data.months ?? []);
        setCurrentMonthLabel(data.currentMonthLabel ?? null);
        setYear(data.year ?? new Date().getFullYear());
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  // Refresh on any leave event coming over the notifications bus.
  useEffect(() => {
    if (lastEvent && lastEvent.action.startsWith("LEAVE")) fetchPlan();
  }, [lastEvent, fetchPlan]);

  // Dates where ≥2 employees are planned off → highlight as collisions.
  const collisionDates = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of employees) for (const d of e.days) count.set(d.date, (count.get(d.date) ?? 0) + 1);
    const set = new Set<string>();
    for (const [date, n] of count) if (n >= 2) set.add(date);
    return set;
  }, [employees]);

  async function recompute() {
    setBusy(true);
    try {
      const res = await fetch("/api/leaves/predictor/recompute", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Piano ricalcolato: ${data.created} giorni generati`);
        await fetchPlan();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDay(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/${id}/confirm`, { method: "POST" });
      if (res.ok) await fetchPlan();
      else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleDay(day: PlanDay) {
    const ok = await confirm({
      title: "Rischedula giorno",
      message: day.confirmedAt
        ? `Il giorno ${day.date} è già CONFERMATO: rischedulandolo verrà annullato (il dipendente riceverà l'avviso di annullamento) ed escluso definitivamente; il predittore ricollocherà la feria su un'altra data.`
        : `Il dipendente non può fare ferie il ${day.date}? Il giorno verrà escluso definitivamente e il predittore ricollocherà la feria su un'altra data (i giorni non ancora confermati possono essere ridistribuiti).`,
      confirmLabel: "Rischedula",
      danger: !!day.confirmedAt,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/predictor/${day.id}/reschedule`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Giorno ${data.excludedDate} escluso — piano ricalcolato (${data.created} giorni)`);
        await fetchPlan();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeExclusion(x: PlanExclusion) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/predictor/exclusions/${x.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Esclusione ${x.date} rimossa. Usa "Ricalcola" per riutilizzare il giorno.`);
        await fetchPlan();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelDay(day: PlanDay) {
    const ok = await confirm({
      title: "Cancella giorno predittore",
      message: `Cancellare il giorno ${day.date}? Usa questa azione se il dipendente non ha potuto goderne.`,
      confirmLabel: "Cancella",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leaves/${day.id}`, { method: "DELETE" });
      if (res.ok) await fetchPlan();
      else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(emp?: PlanEmployee) {
    const today = todayRome();
    const scope = emp ? [emp] : employees;
    const future = scope.flatMap((e) => e.days).filter((d) => d.date > today);
    if (future.length === 0) return;
    const confirmedCount = future.filter((d) => d.confirmedAt).length;
    const ok = await confirm({
      title: emp ? `Elimina piano di ${emp.name}` : "Elimina piano predittore",
      message:
        `Verranno eliminati ${future.length} giorni futuri generati dal predittore` +
        (confirmedCount > 0
          ? `, di cui ${confirmedCount} già confermati (i dipendenti riceveranno l'avviso di annullamento)`
          : "") +
        ". I giorni passati restano. Continuare?",
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const qs = emp ? `?employeeId=${emp.employeeId}` : "";
      const res = await fetch(`/api/leaves/predictor/plan${qs}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.deleted} giorni del predittore eliminati`);
        await fetchPlan();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmAll(emp: PlanEmployee) {
    const unconfirmed = emp.days.filter((d) => !d.confirmedAt);
    if (unconfirmed.length === 0) return;
    setBusy(true);
    try {
      const results = await Promise.all(
        unconfirmed.map((d) => fetch(`/api/leaves/${d.id}/confirm`, { method: "POST" })),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed === 0) toast.success(`${unconfirmed.length} giorni confermati`);
      else toast.error(`${failed} conferme non riuscite`);
      await fetchPlan();
    } finally {
      setBusy(false);
    }
  }

  const totalPlanned = employees.reduce((s, e) => s + e.days.length, 0);
  const totalToConfirm = employees.reduce((s, e) => s + e.days.filter((d) => !d.confirmedAt).length, 0);
  const today = todayRome();
  const hasFutureDays = employees.some((e) => e.days.some((d) => d.date > today));
  const visibleEmployees = employeeFilter
    ? employees.filter((e) => e.employeeId === employeeFilter)
    : employees;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/leaves" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            <ChevronLeft className="h-3.5 w-3.5" /> Ferie
          </Link>
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-on-surface">
            <CalendarClock className="h-5 w-5 text-primary" />
            Piano ammortamento {year}
          </h1>
          <p className="mt-0.5 text-sm text-on-surface-variant">
            {totalPlanned} giorni pianificati · {totalToConfirm} da confermare
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {employees.length > 1 && (
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              aria-label="Filtra per dipendente"
              className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
            >
              <option value="">Tutti i dipendenti</option>
              {employees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>{e.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={recompute}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Ricalcola
          </button>
          {hasFutureDays && (
            <button
              onClick={() => deletePlan()}
              disabled={busy}
              title="Elimina tutti i giorni futuri del predittore (anche confermati)"
              className="inline-flex items-center gap-2 rounded-lg border border-error/40 px-4 py-2 text-sm font-semibold text-error hover:bg-error-container/50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Elimina piano
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
          Caricamento…
        </div>
      ) : employees.length === 0 ? (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
          Nessun dipendente con predittore attivo. Abilita il predittore dal profilo di un dipendente
          (Modifica → &quot;Predittore ammortamento ferie&quot;).
        </div>
      ) : (
        <div className="space-y-4">
          {visibleEmployees.map((emp) => (
            <PlanByEmployee
              key={emp.employeeId}
              emp={emp}
              months={months}
              currentMonthLabel={currentMonthLabel}
              collisionDates={collisionDates}
              busy={busy}
              onConfirm={confirmDay}
              onCancel={cancelDay}
              onReschedule={rescheduleDay}
              onConfirmAll={confirmAll}
              onDeleteAll={deletePlan}
              onRemoveExclusion={removeExclusion}
            />
          ))}
        </div>
      )}
    </div>
  );
}
