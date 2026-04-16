"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  employeeId: string | null;
  employeeName: string | null;
  receiveLeaveNotifications: boolean;
  receiveMonthlyReport: boolean;
  createdAt: string;
}

interface EmployeeOption {
  id: string;
  name: string;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [receiveLeaveNotifications, setReceiveLeaveNotifications] = useState(true);
  const [receiveMonthlyReport, setReceiveMonthlyReport] = useState(true);

  const load = useCallback(async () => {
    try {
      const [userRes, empRes] = await Promise.all([
        fetch(`/api/settings/users/${params.id}`),
        fetch("/api/settings/users").then((r) => (r.ok ? r.json() : { employees: [] })),
      ]);
      if (!userRes.ok) {
        toast.error("Utente non trovato");
        return;
      }
      const data: UserDetail = await userRes.json();
      setUser(data);
      setName(data.name);
      setEmail(data.email);
      setRole(data.role);
      setEmployeeId(data.employeeId);
      setReceiveLeaveNotifications(data.receiveLeaveNotifications);
      setReceiveMonthlyReport(data.receiveMonthlyReport);
      setEmployees(empRes.employees ?? []);
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/users/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          role,
          employeeId,
          receiveLeaveNotifications,
          receiveMonthlyReport,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Utente aggiornato");
        load();
      } else {
        toast.error(data.error ?? "Errore nel salvataggio");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return <p className="p-6 text-sm text-on-surface-variant">Caricamento…</p>;
  if (!user)
    return <p className="p-6 text-sm text-on-surface-variant">Utente non trovato.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/users"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Utenti
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" strokeWidth={1.5} />
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
            {user.name}
          </h1>
          <p className="text-sm text-on-surface-variant">{user.email}</p>
        </div>
        <StatusBadge kind={user.role === "ADMIN" ? "info" : "neutral"} className="ml-2">
          {user.role === "ADMIN" ? "Amministratore" : "Dipendente"}
        </StatusBadge>
      </div>

      {/* Identity */}
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-4">
        <h3 className="text-sm font-semibold text-on-surface">Dati account</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="userName"
              className="block text-xs font-semibold text-on-surface-variant mb-1"
            >
              Nome
            </label>
            <input
              id="userName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <div>
            <label
              htmlFor="userEmail"
              className="block text-xs font-semibold text-on-surface-variant mb-1"
            >
              Email
            </label>
            <input
              id="userEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="userRole"
              className="block text-xs font-semibold text-on-surface-variant mb-1"
            >
              Ruolo
            </label>
            <select
              id="userRole"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="EMPLOYEE">Dipendente</option>
              <option value="ADMIN">Amministratore</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="userEmployee"
              className="block text-xs font-semibold text-on-surface-variant mb-1"
            >
              Dipendente associato
            </label>
            <select
              id="userEmployee"
              value={employeeId ?? ""}
              onChange={(e) => setEmployeeId(e.target.value || null)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">Nessuno (solo admin)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-on-surface-variant">
              Gli admin possono non essere associati a un dipendente.
            </p>
          </div>
        </div>
      </div>

      {/* Preferences — only for admin */}
      {role === "ADMIN" && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-3">
          <h3 className="text-sm font-semibold text-on-surface">Preferenze notifiche</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={receiveLeaveNotifications}
              onChange={(e) => setReceiveLeaveNotifications(e.target.checked)}
              className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <span className="text-sm text-on-surface">
              Ricevi notifiche per richieste ferie
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={receiveMonthlyReport}
              onChange={(e) => setReceiveMonthlyReport(e.target.checked)}
              className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <span className="text-sm text-on-surface">
              Ricevi report presenze mensile
            </span>
          </label>
        </div>
      )}

      {/* Account info */}
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
        <h3 className="text-sm font-semibold text-on-surface mb-2">Info account</h3>
        <p className="text-xs text-on-surface-variant">
          Registrato il {new Date(user.createdAt).toLocaleString("it-IT")}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          Stato:{" "}
          <StatusBadge kind={user.active ? "success" : "error"} className="ml-1">
            {user.active ? "Attivo" : "Disattivato"}
          </StatusBadge>
        </p>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim() || !email.trim()}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-on-primary hover:bg-primary-container shadow-card transition-shadow hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Salvataggio…" : "Salva modifiche"}
        </button>
      </div>
    </div>
  );
}
