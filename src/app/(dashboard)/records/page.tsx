"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, Trash2, Pencil, Filter, Nfc, MessageCircle, RefreshCw, Save, X } from "lucide-react";
import { formatDate } from "@/lib/formatTime";
import { useConfirm } from "@/components/ConfirmProvider";
import { StatusBadge } from "@/components/StatusBadge";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
}

interface Record {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  type: string;
  declaredTime: string;
  messageTime: string;
  rawMessage: string;
  source: string;
  isManual: boolean;
}

interface ListResponse {
  items: Record[];
  total: number;
  limit: number;
  offset: number;
}

const RECORD_TYPES = [
  "ENTRY",
  "EXIT",
  "PAUSE_START",
  "PAUSE_END",
  "OVERTIME_START",
  "OVERTIME_END",
];

const TYPE_LABELS: { [k: string]: string } = {
  ENTRY: "Entrata",
  EXIT: "Uscita",
  PAUSE_START: "Inizio pausa",
  PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario",
  OVERTIME_END: "Fine straordinario",
};

const SOURCE_LABELS: { [k: string]: string } = {
  PARSED: "WhatsApp",
  MANUAL: "Manuale",
  NFC: "NFC",
  TELEGRAM: "Telegram",
};

const PAGE_SIZE = 50;

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export default function RecordsPage() {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filtri
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState("");
  const [editTime, setEditTime] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (employeeId) params.set("employeeId", employeeId);
      if (type) params.set("type", type);
      if (source) params.set("source", source);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const res = await fetch(`/api/records?${params.toString()}`);
      if (!res.ok) {
        toast.error(`Errore ${res.status}`);
        return;
      }
      const data: ListResponse = await res.json();
      setRecords(data.items);
      setTotal(data.total);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setLoading(false);
    }
  }, [from, to, employeeId, type, source, page]);

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((emps: Employee[]) => {
        emps.sort((a, b) =>
          (a.displayName || a.name).localeCompare(b.displayName || b.name)
        );
        setEmployees(emps);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page quando cambia un filtro (esclusa la pagina stessa)
  useEffect(() => {
    setPage(0);
  }, [from, to, employeeId, type, source]);

  const startEdit = (r: Record) => {
    setEditingId(r.id);
    setEditType(r.type);
    setEditTime(r.declaredTime);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditType("");
    setEditTime("");
  };

  const saveEdit = async (r: Record) => {
    if (!/^\d{2}:\d{2}$/.test(editTime)) {
      toast.error("Orario non valido (HH:MM)");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/records/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: editType, declaredTime: editTime }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      toast.success("Timbratura aggiornata");
      cancelEdit();
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (r: Record) => {
    const ok = await confirm({
      title: "Elimina timbratura",
      message: `Eliminare la timbratura ${TYPE_LABELS[r.type] ?? r.type} del ${formatDate(r.date)} alle ${r.declaredTime} per ${r.employee}?`,
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/records/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`Errore ${res.status}`);
        return;
      }
      toast.success("Timbratura eliminata");
      load();
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageButtons = useMemo(
    () =>
      Array.from({ length: totalPages }, (_, i) => {
        const show = i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1;
        const showEllipsis = !show && (i === 1 || i === totalPages - 2);
        return { i, show, showEllipsis };
      }),
    [totalPages, page]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary flex items-center gap-2">
            <Clock className="h-7 w-7" />
            Timbrature
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Lista di tutte le registrazioni di entrata/uscita con possibilità di modifica e cancellazione.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
        >
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      {/* ── Filtri ─────────────────────────────────────────────── */}
      <div className="rounded-lg bg-surface-container-lowest p-4 shadow-card">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
          <Filter className="h-3.5 w-3.5" />
          Filtri
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant">Dal</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded border-0 bg-surface-container-highest px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant">Al</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded border-0 bg-surface-container-highest px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant">Dipendente</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="mt-1 w-full rounded border-0 bg-surface-container-highest px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary/40"
            >
              <option value="">Tutti</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.displayName || e.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded border-0 bg-surface-container-highest px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary/40"
            >
              <option value="">Tutti</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-on-surface-variant">Origine</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 w-full rounded border-0 bg-surface-container-highest px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary/40"
            >
              <option value="">Tutte</option>
              <option value="PARSED">WhatsApp</option>
              <option value="MANUAL">Manuale</option>
              <option value="NFC">NFC</option>
              <option value="TELEGRAM">Telegram</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setSource(source === "NFC" ? "" : "NFC")}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                source === "NFC"
                  ? "bg-success text-on-primary hover:bg-success/90"
                  : "bg-success-container text-success hover:bg-success-container/80"
              }`}
              title="Mostra solo timbrature NFC"
            >
              <Nfc className="h-3.5 w-3.5" /> {source === "NFC" ? "Filtro NFC attivo" : "Solo NFC"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabella ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">Caricamento…</div>
      ) : records.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-card">
          Nessuna timbratura per i filtri selezionati.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-container bg-surface-container-low">
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Data</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Ora</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Dipendente</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Tipo</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Origine</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Note</th>
                  <th scope="col" className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const editing = editingId === r.id;
                  const busy = busyId === r.id;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-surface-container transition-colors hover:bg-surface-container-low/50"
                    >
                      <td className="px-4 py-3 tabular-nums text-on-surface-variant">{formatDate(r.date)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {editing ? (
                          <input
                            type="time"
                            value={editTime}
                            onChange={(e) => setEditTime(e.target.value)}
                            className="w-24 rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/40"
                          />
                        ) : (
                          <span className="font-medium">{r.declaredTime}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{r.employee}</td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/40"
                          >
                            {RECORD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="inline-flex rounded-full bg-primary-fixed/30 px-2 py-0.5 text-xs font-medium text-primary">
                            {TYPE_LABELS[r.type] ?? r.type}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.source === "NFC" ? (
                          <StatusBadge kind="success">
                            <Nfc className="mr-1 h-3 w-3" />
                            {SOURCE_LABELS[r.source]}
                          </StatusBadge>
                        ) : r.source === "TELEGRAM" ? (
                          <StatusBadge kind="info">
                            <MessageCircle className="mr-1 h-3 w-3" />
                            {SOURCE_LABELS[r.source]}
                          </StatusBadge>
                        ) : r.source === "MANUAL" ? (
                          <StatusBadge kind="neutral">
                            {SOURCE_LABELS[r.source]}
                          </StatusBadge>
                        ) : (
                          <StatusBadge kind="neutral">
                            {SOURCE_LABELS[r.source] ?? r.source}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate text-xs text-on-surface-variant" title={r.rawMessage}>
                        {r.rawMessage}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEdit(r)}
                                disabled={busy}
                                className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Save className="h-3 w-3" /> Salva
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={busy}
                                aria-label="Annulla modifica"
                                className="inline-flex min-h-[44px] items-center rounded-md bg-surface-container px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(r)}
                                disabled={busy}
                                aria-label="Modifica timbratura"
                                className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Modifica"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(r)}
                                disabled={busy}
                                aria-label="Elimina timbratura"
                                className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-error-container px-3 py-2 text-xs font-medium text-error hover:bg-error-container/80 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Elimina"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Paginazione ─────────────────────────────────────── */}
          <div className="flex items-center justify-between text-sm text-on-surface-variant">
            <div>
              {total} risultat{total === 1 ? "o" : "i"}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md bg-surface-container px-2.5 py-1.5 text-sm font-medium text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ←
              </button>
              {pageButtons.map(({ i, show, showEllipsis }) => {
                if (!show && !showEllipsis) return null;
                if (showEllipsis) return <span key={i} className="px-1 text-outline-variant">…</span>;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    className={`min-w-[32px] rounded-md px-2.5 py-1.5 text-sm font-medium transition-all ${
                      i === page
                        ? "bg-primary text-on-primary shadow-sm"
                        : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={page + 1 >= totalPages}
                className="rounded-md bg-surface-container px-2.5 py-1.5 text-sm font-medium text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
              >
                →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
