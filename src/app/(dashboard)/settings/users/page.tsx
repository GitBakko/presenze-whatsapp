"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Users, UserCheck, UserX, RefreshCw } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { StatusBadge } from "@/components/StatusBadge";

interface PendingUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  suggestedEmployeeId: string | null;
}

interface ActiveUser {
  id: string;
  email: string;
  name: string;
  role: string;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
  receiveLeaveNotifications: boolean;
  receiveMonthlyReport: boolean;
}

interface EmployeeOption {
  id: string;
  name: string;
  email: string | null;
}

export default function UsersSettingsPage() {
  const confirm = useConfirm();
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [active, setActive] = useState<ActiveUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [assoc, setAssoc] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<{ userId: string; value: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/users");
      if (res.ok) {
        const data = await res.json();
        setPending(data.pending);
        setActive(data.active);
        setEmployees(data.employees);
        // Pre-seleziona i suggerimenti
        const suggestions: Record<string, string> = {};
        for (const p of data.pending) {
          if (p.suggestedEmployeeId) suggestions[p.id] = p.suggestedEmployeeId;
        }
        setAssoc(suggestions);
      }
    } catch {
      toast.error("Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleActivate = async (userId: string) => {
    // empId can be null for admin-only users (no employee association)
    const empId = assoc[userId];
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, employeeId: empId || null }),
      });
      if (res.ok) {
        toast.success("Utente attivato e notificato");
        loadAll();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nell'attivazione");
      }
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleDeactivate = async (userId: string) => {
    const ok = await confirm({
      title: "Disattiva utente",
      message: "L'utente non potrà più accedere al portale. Vuoi continuare?",
      confirmLabel: "Disattiva",
      danger: true,
    });
    if (!ok) return;
    setPendingId(userId);
    try {
      const res = await fetch(`/api/settings/users?id=${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Utente disattivato");
        loadAll();
      } else {
        toast.error("Errore");
      }
    } finally {
      setPendingId(null);
    }
  };

  async function handleChangeName(userId: string, name: string) {
    const res = await fetch("/api/settings/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name }),
    });
    if (res.ok) {
      toast.success("Nome aggiornato");
      loadAll();
    } else {
      toast.error("Errore nell'aggiornamento");
    }
  }

  async function handleChangeEmployee(userId: string, employeeId: string | null) {
    const res = await fetch("/api/settings/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, employeeId }),
    });
    if (res.ok) {
      toast.success(employeeId ? "Dipendente associato" : "Associazione rimossa");
      loadAll();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Errore nell'aggiornamento");
    }
  }

  async function handleToggleMonthlyReport(userId: string, value: boolean) {
    const res = await fetch("/api/settings/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, receiveMonthlyReport: value }),
    });
    if (res.ok) {
      toast.success(value ? "Report mensile attivato" : "Report mensile disattivato");
      loadAll();
    } else {
      toast.error("Errore nell'aggiornamento");
    }
  }

  async function handleToggleNotifications(userId: string, value: boolean) {
    const res = await fetch("/api/settings/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, receiveLeaveNotifications: value }),
    });
    if (res.ok) {
      toast.success(value ? "Notifiche ferie attivate" : "Notifiche ferie disattivate");
      loadAll();
    } else {
      toast.error("Errore nell'aggiornamento");
    }
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch("/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) {
        toast.success(`Ruolo aggiornato a ${newRole === "ADMIN" ? "Amministratore" : "Dipendente"}`);
        loadAll();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nell'aggiornamento del ruolo");
      }
    } catch {
      toast.error("Errore di rete");
    }
  };

  // Dipendenti già associati a un utente attivo (non mostrarli nel dropdown)
  const linkedEmployeeIds = new Set(
    active.filter((u) => u.employeeId).map((u) => u.employeeId!)
  );
  const availableEmployees = employees.filter(
    (e) => !linkedEmployeeIds.has(e.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Impostazioni
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-primary flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" /> Utenti dipendenti
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Attiva gli account dei dipendenti registrati e associali al loro profilo.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
        >
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      {loading && <div className="text-sm text-on-surface-variant">Caricamento…</div>}

      {!loading && (
        <>
          {/* Utenti in attesa */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              In attesa di attivazione{" "}
              <StatusBadge kind="warning" className="ml-2">{pending.length}</StatusBadge>
            </h2>
            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessun utente in attesa. Quando un dipendente si registra sul portale, comparirà qui.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Nome</th>
                      <th className="px-4 py-2">Registrato il</th>
                      <th className="px-4 py-2">Associa a dipendente</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((u) => (
                      <tr key={u.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant">
                          {new Date(u.createdAt).toLocaleDateString("it-IT")}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={assoc[u.id] || ""}
                            onChange={(e) =>
                              setAssoc((p) => ({ ...p, [u.id]: e.target.value }))
                            }
                            className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                          >
                            <option value="">Nessuno (solo admin)</option>
                            {availableEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}{e.email ? ` (${e.email})` : ""}
                              </option>
                            ))}
                          </select>
                          {u.suggestedEmployeeId && (
                            <span aria-label="email associata" className="ml-2 text-[10px] text-emerald-700 font-semibold">
                              ✓ match email
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleActivate(u.id)}
                              aria-label="Attiva utente"
                              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90 disabled:opacity-40"
                            >
                              <UserCheck className="h-3 w-3" /> Attiva
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Utenti attivi */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Utenti attivi{" "}
              <StatusBadge kind="success" className="ml-2">{active.length}</StatusBadge>
            </h2>
            {active.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessun utente attivo.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Nome</th>
                      <th className="px-4 py-2">Ruolo</th>
                      <th className="px-4 py-2">Dipendente</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((u) => (
                      <tr key={u.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          {editingName?.userId === u.id ? (
                            <input
                              type="text"
                              value={editingName.value}
                              onChange={(e) => setEditingName({ userId: u.id, value: e.target.value })}
                              onBlur={() => {
                                if (editingName.value.trim() && editingName.value !== u.name) {
                                  handleChangeName(u.id, editingName.value.trim());
                                }
                                setEditingName(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditingName(null);
                              }}
                              autoFocus
                              className="w-full rounded border border-outline-variant/40 bg-surface-container-lowest px-2 py-1 text-sm focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingName({ userId: u.id, value: u.name })}
                              className="text-left font-medium text-on-surface hover:text-primary cursor-pointer"
                              title="Clicca per modificare"
                            >
                              {u.name}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                              className="rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold focus:ring-1 focus:ring-primary/20 bg-primary-fixed/30 text-primary"
                            >
                              <option value="EMPLOYEE">Dipendente</option>
                              <option value="ADMIN">Amministratore</option>
                            </select>
                            {u.role === "ADMIN" && (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={u.receiveLeaveNotifications}
                                  onChange={() => handleToggleNotifications(u.id, !u.receiveLeaveNotifications)}
                                  className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                                />
                                <span className="text-xs text-on-surface-variant">Notifiche ferie</span>
                              </label>
                            )}
                            {u.role === "ADMIN" && (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={u.receiveMonthlyReport}
                                  onChange={() => handleToggleMonthlyReport(u.id, !u.receiveMonthlyReport)}
                                  className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                                />
                                <span className="text-xs text-on-surface-variant">Report mensile</span>
                              </label>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.employeeId ?? ""}
                            onChange={(e) => handleChangeEmployee(u.id, e.target.value || null)}
                            className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2 py-1 text-xs text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            <option value="">Nessuno (solo admin)</option>
                            {/* Show the currently associated employee even if they're "taken" */}
                            {u.employeeId && u.employeeName && (
                              <option value={u.employeeId}>{u.employeeName}</option>
                            )}
                            {/* Show available (unlinked) employees */}
                            {availableEmployees
                              .filter((e) => e.id !== u.employeeId)
                              .map((e) => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleDeactivate(u.id)}
                              disabled={pendingId === u.id}
                              aria-label="Disattiva utente"
                              className="inline-flex items-center gap-1 rounded-md bg-error-container px-2.5 py-1 text-xs font-medium text-error hover:bg-error-container/80 disabled:opacity-40"
                            >
                              <UserX className="h-3 w-3" /> Disattiva
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
