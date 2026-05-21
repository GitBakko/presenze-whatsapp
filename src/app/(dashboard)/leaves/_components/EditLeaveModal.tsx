"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useConfirm } from "@/components/ConfirmProvider";
import { hmToMinutes } from "@/lib/date-utils";
import { formatItDate } from "@/lib/leaves/format";
import type { LeaveRequest } from "./types";
import { LEAVE_TYPE_OPTIONS } from "./types";

interface EditEntry {
  id: string;
  editedAt: string;
  editedBy: string | null;
  changedFields: string[];
  reason: string | null;
}

export interface EditLeaveModalProps {
  request: LeaveRequest;
  onClose: () => void;
  onSaved: () => void;
}

export function EditLeaveModal({ request, onClose, onSaved }: EditLeaveModalProps) {
  const modalContentRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  // ── Form state, prefilled from request ──
  const [type, setType] = useState<string>(request.type);
  const [startDate, setStartDate] = useState<string>(request.startDate);
  const [endDate, setEndDate] = useState<string>(request.endDate);
  const [hours, setHours] = useState<string>(request.hours != null ? String(request.hours) : "");
  const initialSlot = request.timeSlots && request.timeSlots.length > 0 ? request.timeSlots[0] : null;
  const [timeFrom, setTimeFrom] = useState<string>(initialSlot?.from ?? "");
  const [timeTo, setTimeTo] = useState<string>(initialSlot?.to ?? "");
  const [sickProtocol, setSickProtocol] = useState<string>(request.sickProtocol ?? "");
  const [notes, setNotes] = useState<string>(request.notes ?? "");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const [preview, setPreview] = useState<null | {
    effectiveDays: number | null;
    breakdown?: Array<{ date: string; working: boolean; reason?: string }>;
    hoursMode?: boolean;
  }>(null);

  const [history, setHistory] = useState<EditEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const needsHours = ["ROL", "BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"].includes(type);
  const isSick = type === "SICK";
  const isHalfDay = type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM";

  // For half-day requests endDate is implicitly startDate.
  const effectiveEndDate = isHalfDay ? startDate : endDate;

  // ── Dirty detection ──
  const initialSlotsKey = JSON.stringify(request.timeSlots ?? []);
  const currentSlotsKey = JSON.stringify(
    needsHours && timeFrom && timeTo ? [{ from: timeFrom, to: timeTo }] : []
  );
  const initialHoursKey = request.hours != null ? String(request.hours) : "";
  const isDirty =
    type !== request.type ||
    startDate !== request.startDate ||
    effectiveEndDate !== request.endDate ||
    hours !== initialHoursKey ||
    currentSlotsKey !== initialSlotsKey ||
    sickProtocol !== (request.sickProtocol ?? "") ||
    notes !== (request.notes ?? "") ||
    reason !== "";

  // ── Close handler with dirty-confirm ──
  async function handleClose() {
    if (isDirty) {
      const ok = await confirm({
        title: "Annullare le modifiche?",
        message: "Le modifiche non salvate andranno perse.",
        confirmLabel: "Sì, annulla",
        cancelLabel: "Continua a modificare",
      });
      if (!ok) return;
    }
    onClose();
  }

  useModalA11y(modalContentRef, handleClose);

  // ── Preview effect (working days) ──
  useEffect(() => {
    if (!request.employeeId || !startDate || !effectiveEndDate || !type) {
      setPreview(null);
      return;
    }
    if (startDate > effectiveEndDate) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/leaves/preview-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: request.employeeId,
            startDate,
            endDate: effectiveEndDate,
            type,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setPreview(null);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [request.employeeId, startDate, effectiveEndDate, type]);

  // ── History lazy load on first expand ──
  useEffect(() => {
    if (!historyOpen || history !== null) return;
    setHistoryLoading(true);
    fetch(`/api/leaves/${request.id}/edits`)
      .then(r => (r.ok ? r.json() : []))
      .then((data: EditEntry[]) => setHistory(data))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [historyOpen, history, request.id]);

  // ── Submit ──
  async function handleSubmit(confirmOverride = false) {
    setSubmitting(true);
    try {
      const computedHours = needsHours
        ? (timeFrom && timeTo
            ? Math.round(((hmToMinutes(timeTo) - hmToMinutes(timeFrom)) / 60) * 10) / 10
            : (hours === "" ? null : parseFloat(hours) || null))
        : null;

      const computedTimeSlots = needsHours && timeFrom && timeTo
        ? [{ from: timeFrom, to: timeTo }]
        : null;

      const payload: Record<string, unknown> = {
        version: request.version,
        type,
        startDate,
        endDate: effectiveEndDate,
        hours: computedHours,
        timeSlots: computedTimeSlots,
        sickProtocol: isSick ? (sickProtocol || null) : null,
        notes: notes || null,
      };
      if (reason.trim()) payload.reason = reason.trim();
      if (confirmOverride) payload.confirmOverride = true;

      const res = await fetch(`/api/leaves/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({} as { error?: string; message?: string }));

        if (err.error === "OVERLAP_REQUIRES_CONFIRM") {
          const proceed = await confirm({
            title: "Conflitto rilevato",
            message: "Esiste una richiesta in conflitto. Procedere comunque?",
            confirmLabel: "Conferma e salva",
          });
          if (proceed) {
            await handleSubmit(true);
          }
          return;
        }
        if (err.error === "STALE_STATE") {
          toast.error("La richiesta è stata modificata da qualcun altro. Ricarica la pagina.");
          return;
        }
        if (err.error === "OVERLAP_BLOCK") {
          toast.error(`Conflitto: ${err.message ?? "richiesta sovrapposta"}`);
          return;
        }
        if (err.error === "EDIT_NOT_ALLOWED_REJECTED") {
          toast.error("Non si possono modificare richieste rifiutate");
          return;
        }
        if (err.error === "VALIDATION_FAILED") {
          toast.error("Dati non validi: verifica i campi");
          return;
        }
        if (err.error === "INVALID_RANGE") {
          toast.error("Intervallo date non valido");
          return;
        }
        toast.error(err.error ?? err.message ?? "Errore modifica");
        return;
      }

      toast.success("Richiesta modificata");
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        ref={modalContentRef}
        className="w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6 shadow-editorial"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-leave-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="edit-leave-title" className="font-display text-lg font-bold text-primary">
            Modifica richiesta di {request.employeeName}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Chiudi"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-outline-variant hover:text-on-surface"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(false);
          }}
          className="space-y-4"
        >
          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Tipo
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {LEAVE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                {isHalfDay ? "Data" : "Data inizio"}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
            {!isHalfDay && (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  Data fine
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
            )}
          </div>

          {/* Working-days preview */}
          {preview && preview.effectiveDays !== null && !preview.hoursMode && (
            <div className="mt-2 rounded border border-outline-variant/30 bg-surface-container px-3 py-2 text-sm">
              <strong>Userai {preview.effectiveDays} giorni lavorativi.</strong>
              {preview.breakdown && preview.breakdown.filter((b) => !b.working).length > 0 && (
                <div className="mt-1 text-xs text-on-surface-variant">
                  Giorni non lavorativi esclusi:{" "}
                  {preview.breakdown
                    .filter((b) => !b.working)
                    .map((b) => `${formatItDate(b.date)} (${b.reason ?? ""})`)
                    .join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Hours (for ROL-type) */}
          {needsHours && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Dalle
                  </label>
                  <input
                    type="time"
                    value={timeFrom}
                    onChange={(e) => {
                      setTimeFrom(e.target.value);
                      if (e.target.value && timeTo) {
                        const mins = hmToMinutes(timeTo) - hmToMinutes(e.target.value);
                        if (mins > 0) setHours(String(Math.round((mins / 60) * 10) / 10));
                      }
                    }}
                    className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    placeholder="09:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Alle
                  </label>
                  <input
                    type="time"
                    value={timeTo}
                    onChange={(e) => {
                      setTimeTo(e.target.value);
                      if (timeFrom && e.target.value) {
                        const mins = hmToMinutes(e.target.value) - hmToMinutes(timeFrom);
                        if (mins > 0) setHours(String(Math.round((mins / 60) * 10) / 10));
                      }
                    }}
                    className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    placeholder="10:00"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  Ore totali {timeFrom && timeTo ? "(calcolate)" : ""}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  readOnly={!!(timeFrom && timeTo)}
                  className={`w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${timeFrom && timeTo ? "bg-surface-container text-on-surface-variant" : ""}`}
                  placeholder="Es: 2"
                />
                <p className="mt-1 text-[11px] text-outline-variant">
                  Specifica &quot;Dalle — Alle&quot; per inserire la fascia oraria esatta, oppure lascia vuoti e inserisci solo le ore totali.
                </p>
              </div>
            </div>
          )}

          {/* Sick protocol */}
          {isSick && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Protocollo INPS (opzionale)
              </label>
              <input
                type="text"
                value={sickProtocol}
                onChange={(e) => setSickProtocol(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                placeholder="Numero certificato"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Note (opzionale)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          {/* Motivo modifica (interno) */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Motivo modifica (interno, opzionale)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              placeholder="Verrà incluso nelle notifiche al dipendente"
            />
          </div>

          {/* Storia modifiche */}
          <details
            className="rounded-lg border border-outline-variant/30 bg-surface-container/30 px-3 py-2"
            open={historyOpen}
            onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-on-surface-variant">
              Storia modifiche
            </summary>
            {historyOpen && historyLoading && (
              <div className="mt-2 text-sm text-on-surface-variant">Caricamento…</div>
            )}
            {historyOpen && history !== null && !historyLoading && history.length === 0 && (
              <div className="mt-2 text-sm text-on-surface-variant">Nessuna modifica precedente.</div>
            )}
            {historyOpen && history && history.length > 0 && (
              <ul className="mt-2 space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-outline-variant/50 pl-3">
                    <div className="text-xs text-outline-variant">
                      {formatItDate(h.editedAt.slice(0, 10))} — {h.editedBy ?? "Sistema"}
                    </div>
                    <div className="text-on-surface">
                      Campi: {h.changedFields.join(", ")}
                    </div>
                    {h.reason && (
                      <div className="text-xs text-on-surface-variant">Motivo: {h.reason}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={!isDirty || submitting}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Salvataggio..." : "Salva modifiche"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
