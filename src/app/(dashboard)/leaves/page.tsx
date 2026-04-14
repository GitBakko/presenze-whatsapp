"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Hourglass, Plus, Calendar, List, Users,
} from "lucide-react";
import { useConfirm, useConfirmWithPrompt } from "@/components/ConfirmProvider";

import type { LeaveRequest, CalendarDay, Employee, LeaveBalance, ByEmployeeCard } from "./_components/types";
import { BalanceCard } from "./_components/BalanceCard";
import { CalendarView } from "./_components/CalendarView";
import { RequestsList } from "./_components/RequestsList";
import { ByEmployeeView } from "./_components/ByEmployeeView";
import { CreateLeaveModal } from "./_components/CreateLeaveModal";

export default function LeavesPage() {
  const confirm = useConfirm();
  const confirmWithPrompt = useConfirmWithPrompt();
  const { data: leavesSession } = useSession();
  const leavesRole = (leavesSession?.user as { role?: string } | undefined)?.role ?? "EMPLOYEE";
  const isLeavesAdmin = leavesRole === "ADMIN";
  const [tab, setTab] = useState<"calendar" | "requests" | "byEmployee">("calendar");
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
  const [byEmployee, setByEmployee] = useState<ByEmployeeCard[]>([]);
  const [byEmployeeLoading, setByEmployeeLoading] = useState(false);

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

  const fetchByEmployee = useCallback(async () => {
    setByEmployeeLoading(true);
    try {
      const res = await fetch("/api/leaves/by-employee");
      if (res.ok) {
        const data = await res.json();
        setByEmployee(data.employees);
      }
    } finally {
      setByEmployeeLoading(false);
    }
  }, []);

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);
  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
  useEffect(() => {
    if (tab === "byEmployee") fetchByEmployee();
  }, [tab, fetchByEmployee]);
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

  async function handleDelete(r: LeaveRequest) {
    const period =
      r.startDate === r.endDate
        ? r.startDate
        : `dal ${r.startDate} al ${r.endDate}`;

    if (r.status === "APPROVED") {
      const { confirmed, value: reason } = await confirmWithPrompt({
        title: "Elimina ferie già approvate",
        message: (
          <>
            Stai eliminando le ferie <strong>già approvate</strong> di{" "}
            <strong>{r.employeeName}</strong> {period}.
            <br />
            <br />
            Il dipendente sarà notificato della cancellazione via email e
            Telegram (se configurato). Vuoi continuare?
          </>
        ),
        promptLabel: "Motivo (comunicato al dipendente)",
        promptPlaceholder: "Opzionale — es. annullata su richiesta del dipendente",
        promptMultiline: true,
        confirmLabel: "Elimina e notifica",
        danger: true,
      });
      if (!confirmed) return;

      const res = await fetch(`/api/leaves/${r.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      if (res.ok) {
        toast.success("Ferie eliminate. Dipendente notificato.");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nella cancellazione");
      }
      fetchRequests();
      fetchCalendar();
      return;
    }

    const ok = await confirm({
      title: "Elimina richiesta",
      message:
        r.status === "PENDING"
          ? `Eliminare la richiesta in attesa di ${r.employeeName} ${period}? Il dipendente sarà notificato.`
          : `Eliminare questa richiesta rifiutata di ${r.employeeName} ${period}?`,
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;

    const res = await fetch(`/api/leaves/${r.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Richiesta eliminata");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Errore nella cancellazione");
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

  const firstDay = (() => {
    const [y, m] = calendarMonth.split("-").map(Number);
    const d = new Date(y, m - 1, 1).getDay();
    return d === 0 ? 6 : d - 1;
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
        {isLeavesAdmin && (
        <button
          onClick={() => setTab("byEmployee")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${tab === "byEmployee" ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-primary"}`}
        >
          <Users className="mr-1 inline h-4 w-4 align-middle text-emerald-500" />
          Per dipendente
        </button>
        )}
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
          isAdmin={isLeavesAdmin}
        />
      )}

      {tab === "byEmployee" && (
        <ByEmployeeView
          loading={byEmployeeLoading}
          cards={byEmployee}
          onRefresh={fetchByEmployee}
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
