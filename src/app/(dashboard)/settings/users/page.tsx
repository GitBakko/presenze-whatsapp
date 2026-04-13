"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Users, UserCheck, UserX, RefreshCw } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

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
    const empId = assoc[userId];
    if (!empId) {
      toast.warning("Seleziona prima un dipendente da associare");
      return;
    }
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, employeeId: empId }),
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
    const res = await fetch(`/api/settings/users?id=${userId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Utente disattivato");
      loadAll();
    } else {
      toast.error("Errore");
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
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <Users className="h-7 w-7 text-indigo-500" /> Utenti dipendenti
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
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {pending.length}
              </span>
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
                            <option value="">— scegli —</option>
                            {availableEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}{e.email ? ` (${e.email})` : ""}
                              </option>
                            ))}
                          </select>
                          {u.suggestedEmployeeId && (
                            <span className="ml-2 text-[10px] text-emerald-700 font-semibold">
                              ✓ match email
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleActivate(u.id)}
                              disabled={!assoc[u.id]}
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
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                {active.length}
              </span>
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
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            u.role === "ADMIN"
                              ? "bg-violet-100 text-violet-800"
                              : "bg-blue-100 text-blue-800"
                          }`}>
                            {u.role === "ADMIN" ? "Admin" : "Dipendente"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {u.employeeName ?? <span className="text-on-surface-variant">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {u.role !== "ADMIN" && (
                              <button
                                type="button"
                                onClick={() => handleDeactivate(u.id)}
                                className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                              >
                                <UserX className="h-3 w-3" /> Disattiva
                              </button>
                            )}
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
