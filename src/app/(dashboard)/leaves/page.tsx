"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Hourglass, Plus, Calendar, List, X,
  ChevronLeft, ChevronRight, CalendarX2,
  CheckCircle, XCircle, Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

// ── Types ──

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: { from: string; to: string }[] | null;
  sickProtocol: string | null;
  notes: string | null;
  status: string;
  source: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface CalendarEvent {
  employeeId: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  status: string;
  hours?: number | null;
}

interface CalendarDay {
  date: string;
  events: CalendarEvent[];
}

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
}

interface LeaveBalance {
  year: number;
  vacationAccrued: number;
  vacationUsed: number;
  vacationCarryOver: number;
  vacationRemaining: number;
  rolAccrued: number;
  rolUsed: number;
  rolCarryOver: number;
  rolRemaining: number;
  sickDays: number;
  weeklyHours: number;
  contractType: string;
}

const LEAVE_TYPE_OPTIONS = [
  { value: "VACATION", label: "Ferie (giornata intera)" },
  { value: "VACATION_HALF_AM", label: "Ferie (mattina)" },
  { value: "VACATION_HALF_PM", label: "Ferie (pomeriggio)" },
  { value: "ROL", label: "Permesso orario (ROL)" },
  { value: "SICK", label: "Malattia" },
  { value: "BEREAVEMENT", label: "Lutto" },
  { value: "MARRIAGE", label: "Matrimonio" },
  { value: "LAW_104", label: "L. 104" },
  { value: "MEDICAL_VISIT", label: "Visita medica" },
];

const TYPE_COLORS: Record<string, string> = {
  VACATION: "bg-blue-100 text-blue-800",
  VACATION_HALF_AM: "bg-blue-50 text-blue-700",
  VACATION_HALF_PM: "bg-blue-50 text-blue-700",
  ROL: "bg-amber-100 text-amber-800",
  SICK: "bg-red-100 text-red-800",
  BEREAVEMENT: "bg-purple-100 text-purple-800",
  MARRIAGE: "bg-pink-100 text-pink-800",
  LAW_104: "bg-teal-100 text-teal-800",
  MEDICAL_VISIT: "bg-cyan-100 text-cyan-800",
};

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  REJECTED: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<string, string> = {
  APPROVED: "Approvata",
  PENDING: "In attesa",
  REJECTED: "Rifiutata",
};

// ── Main page ──

export default function LeavesPage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<"calendar" | "requests">("calendar");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  // ── Fetch data ──

  const fetchCalendar = useCallback(async () => {
    const res = await fetch(`/api/leaves/calendar?month=${calendarMonth}`);
    if (res.ok) {
      const data = await res.json();
      setCalendarDays(data.calendar);
    }
  }, [calendarMonth]);

  const fetchRequests = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const res = await fetch(`/api/leaves?${params}`);
    if (res.ok) setRequests(await res.json());
  }, [statusFilter]);

  const fetchEmployees = useCallback(async () => {
    const res = await fetch("/api/employees");
    if (res.ok) {
      const data = await res.json();
      setEmployees(data.map((e: Employee & { displayName: string | null }) => ({
        id: e.id,
        name: e.displayName || e.name,
        displayName: e.displayName,
      })));
    }
  }, []);

  const fetchBalance = useCallback(async (empId: string) => {
    const res = await fetch(`/api/leaves/balance/${empId}`);
    if (res.ok) setBalance(await res.json());
    else setBalance(null);
  }, []);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);
  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
  useEffect(() => {
    if (selectedEmployee) fetchBalance(selectedEmployee);
    else setBalance(null);
  }, [selectedEmployee, fetchBalance]);

  // ── Actions ──

  async function handleApprove(id: string) {
    const res = await fetch(`/api/leaves/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    if (res.ok) {
      toast.success("Richiesta approvata");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || `Errore ${res.status}`);
    }
    fetchRequests();
    fetchCalendar();
  }

  async function handleReject(id: string) {
    const res = await fetch(`/api/leaves/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED" }),
    });
    if (res.ok) {
      toast.success("Richiesta rifiutata");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || `Errore ${res.status}`);
    }
    fetchRequests();
    fetchCalendar();
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Elimina richiesta",
      message: "Eliminare questa richiesta di ferie/permesso?",
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/leaves/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Richiesta eliminata");
    } else {
      toast.error("Errore nella cancellazione");
    }
    fetchRequests();
    fetchCalendar();
  }

  // ── Calendar helpers ──

  function changeMonth(delta: number) {
    const [y, m] = calendarMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const monthLabel = (() => {
    const [y, m] = calendarMonth.split("-").map(Number);
    return new Date(y, m - 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  })();

  // Build calendar grid
  const firstDay = (() => {
    const [y, m] = calendarMonth.split("-").map(Number);
    const d = new Date(y, m - 1, 1).getDay();
    return d === 0 ? 6 : d - 1; // Monday-based
  })();

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
            Ferie & Permessi
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Gestisci ferie, permessi ROL, malattie e assenze
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">
              <Hourglass className="h-3.5 w-3.5 text-amber-500" />
              {pendingCount} da approvare
            </span>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Nuova richiesta
          </button>
        </div>
      </div>

      {/* Balance card for selected employee */}
      {selectedEmployee && balance && (
        <BalanceCard balance={balance} employeeName={employees.find((e) => e.id === selectedEmployee)?.name ?? ""} onClose={() => setSelectedEmployee(null)} />
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-container-high p-1">
        <button
          onClick={() => setTab("calendar")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${tab === "calendar" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-primary"}`}
        >
          <Calendar className="mr-1 inline h-4 w-4 align-middle text-blue-500" />
          Calendario
        </button>
        <button
          onClick={() => setTab("requests")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${tab === "requests" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-primary"}`}
        >
          <List className="mr-1 inline h-4 w-4 align-middle text-violet-500" />
          Richieste
          {pendingCount > 0 && (
            <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {tab === "calendar" && (
        <CalendarView
          calendarDays={calendarDays}
          calendarMonth={calendarMonth}
          monthLabel={monthLabel}
          firstDay={firstDay}
          onChangeMonth={changeMonth}
          onSelectEmployee={setSelectedEmployee}
        />
      )}

      {tab === "requests" && (
        <RequestsList
          requests={requests}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onApprove={handleApprove}
          onReject={handleReject}
          onDelete={handleDelete}
          onSelectEmployee={setSelectedEmployee}
        />
      )}

      {/* Create form modal */}
      {showForm && (
        <CreateLeaveModal
          employees={employees}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            fetchRequests();
            fetchCalendar();
          }}
          loading={loading}
          setLoading={setLoading}
        />
      )}
    </div>
  );
}

// ── Balance Card ──

function BalanceCard({ balance, employeeName, onClose }: { balance: LeaveBalance; employeeName: string; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary">
          Saldo {balance.year} — {employeeName}
        </h3>
        <button onClick={onClose} className="text-outline-variant hover:text-on-surface">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <BalanceItem label="Ferie residue" value={`${balance.vacationRemaining} gg`} sub={`Maturate: ${balance.vacationAccrued} | Usate: ${balance.vacationUsed}`} color="blue" numericValue={balance.vacationRemaining} />
        <BalanceItem label="ROL residui" value={`${balance.rolRemaining} h`} sub={`Maturate: ${balance.rolAccrued} | Usate: ${balance.rolUsed}`} color="amber" numericValue={balance.rolRemaining} />
        <BalanceItem label="Malattia" value={`${balance.sickDays} gg`} sub="Nessun limite annuale" color="red" />
        <BalanceItem label="Contratto" value={balance.contractType === "FULL_TIME" ? "Full-time" : "Part-time"} sub={`${balance.weeklyHours}h/settimana`} color="teal" />
      </div>
    </div>
  );
}

function BalanceItem({ label, value, sub, color, numericValue }: { label: string; value: string; sub: string; color: string; numericValue?: number }) {
  const isNegative = numericValue !== undefined && numericValue < 0;
  const bgClass = isNegative ? "bg-red-50 ring-1 ring-red-200" : `bg-${color}-50`;
  const textClass = isNegative ? "text-red-600" : `text-${color}-700`;
  return (
    <div className={`rounded-lg ${bgClass} p-3`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${textClass}`}>{value}</p>
      <p className="mt-1 text-xs text-outline-variant">{sub}</p>
    </div>
  );
}

// ── Calendar View ──

function CalendarView({
  calendarDays,
  calendarMonth: _calendarMonth,
  monthLabel,
  firstDay,
  onChangeMonth,
  onSelectEmployee,
}: {
  calendarDays: CalendarDay[];
  calendarMonth: string;
  monthLabel: string;
  firstDay: number;
  onChangeMonth: (delta: number) => void;
  onSelectEmployee: (id: string) => void;
}) {
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white shadow-sm">
      {/* Month nav */}
      <div className="flex items-center justify-between border-b border-surface-container px-5 py-4">
        <button onClick={() => onChangeMonth(-1)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-high">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary capitalize">
          {monthLabel}
        </h3>
        <button onClick={() => onChangeMonth(1)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-high">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-surface-container">
        {dayNames.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-outline-variant">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {/* Empty cells for offset */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-surface-container-low bg-surface-container-low" />
        ))}

        {calendarDays.map((day) => {
          const isToday = day.date === today;
          const dayNum = parseInt(day.date.split("-")[2]);
          const isWeekend = (() => {
            const d = new Date(day.date);
            return d.getDay() === 0 || d.getDay() === 6;
          })();

          return (
            <div
              key={day.date}
              className={`min-h-[80px] border-b border-r border-surface-container-low p-1.5 ${isWeekend ? "bg-surface-container-low/50" : ""} ${isToday ? "bg-primary/5" : ""}`}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${isToday ? "bg-primary text-white" : "text-on-surface-variant"}`}>
                {dayNum}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {day.events.slice(0, 3).map((ev, i) => {
                  const isPending = ev.status === "PENDING";
                  return (
                    <button
                      key={i}
                      onClick={() => onSelectEmployee(ev.employeeId)}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold leading-tight ${TYPE_COLORS[ev.type] ?? "bg-surface-container-high text-on-surface"} ${isPending ? "opacity-60 ring-1 ring-inset ring-yellow-400 ring-offset-0" : ""}`}
                      title={`${ev.employeeName} — ${ev.typeLabel}${isPending ? " (in attesa)" : ""}`}
                    >
                      {isPending && <Hourglass className="mr-0.5 inline h-2.5 w-2.5" />}{ev.employeeName.split(" ")[0]}
                    </button>
                  );
                })}
                {day.events.length > 3 && (
                  <span className="block text-center text-[10px] text-outline-variant">
                    +{day.events.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 border-t border-surface-container px-5 py-3">
        {[
          { label: "Ferie", color: "bg-blue-100 text-blue-800" },
          { label: "ROL", color: "bg-amber-100 text-amber-800" },
          { label: "Malattia", color: "bg-red-100 text-red-800" },
          { label: "Altro", color: "bg-purple-100 text-purple-800" },
        ].map((item) => (
          <span key={item.label} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${item.color}`}>
            {item.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-400">
          <Hourglass className="h-2.5 w-2.5" /> In attesa
        </span>
      </div>
    </div>
  );
}

// ── Requests List ──

function RequestsList({
  requests,
  statusFilter,
  onStatusFilter,
  onApprove,
  onReject,
  onDelete,
  onSelectEmployee,
}: {
  requests: LeaveRequest[];
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onSelectEmployee: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2">
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button
            key={s}
            onClick={() => onStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${statusFilter === s ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"}`}
          >
            {s === "ALL" ? "Tutte" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Table */}
      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/30 bg-white py-16 text-center">
          <CalendarX2 className="mb-3 h-12 w-12 text-outline-variant" />
          <p className="text-sm text-on-surface-variant">Nessuna richiesta trovata</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low/50">
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Dipendente</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Tipo</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Periodo</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Ore</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Stato</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Fonte</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {requests.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-container-low/50">
                  <td className="px-4 py-3">
                    <button onClick={() => onSelectEmployee(r.employeeId)} className="font-semibold text-primary hover:underline">
                      {r.employeeName}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${TYPE_COLORS[r.type] ?? "bg-surface-container-high text-on-surface"}`}>
                      {r.typeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {r.hours ? `${r.hours}h` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[r.status] ?? ""}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-outline-variant">
                    {r.source === "EXTERNAL_API" ? "API" : "Manager"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {r.status === "PENDING" && (
                        <>
                          <button onClick={() => onApprove(r.id)} className="rounded-lg p-1 text-green-600 hover:bg-green-50" title="Approva">
                            <CheckCircle className="h-5 w-5" />
                          </button>
                          <button onClick={() => onReject(r.id)} className="rounded-lg p-1 text-red-500 hover:bg-red-50" title="Rifiuta">
                            <XCircle className="h-5 w-5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => onDelete(r.id)} className="rounded-lg p-1 text-outline-variant hover:bg-surface-container-high hover:text-red-500" title="Elimina">
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Create Leave Modal ──

function CreateLeaveModal({
  employees,
  onClose,
  onCreated,
  loading,
  setLoading,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: () => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("VACATION");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [sickProtocol, setSickProtocol] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const needsHours = ["ROL", "BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"].includes(type);
  const isSick = type === "SICK";
  const isHalfDay = type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!employeeId || !startDate) {
      setError("Seleziona dipendente e data");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          type,
          startDate,
          endDate: isHalfDay ? startDate : (endDate || startDate),
          hours: needsHours ? parseFloat(hours) || null : null,
          sickProtocol: isSick ? sickProtocol || null : null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error || "Errore nella creazione");
        } catch {
          setError("Errore nella creazione");
        }
        return;
      }

      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-primary">Nuova Richiesta</h2>
          <button onClick={onClose} className="text-outline-variant hover:text-on-surface">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Employee */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Dipendente</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">Seleziona...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {LEAVE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Data fine</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
            )}
          </div>

          {/* Hours (for ROL-type) */}
          {needsHours && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Ore</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                placeholder="Es: 2"
              />
            </div>
          )}

          {/* Sick protocol */}
          {isSick && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Protocollo INPS (opzionale)</label>
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
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Note (opzionale)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          {error && (
            <p className="text-sm font-semibold text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Salvataggio..." : "Crea richiesta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
