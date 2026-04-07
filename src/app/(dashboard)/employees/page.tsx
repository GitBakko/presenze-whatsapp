"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDate } from "@/lib/formatTime";
import { Pencil, UserPlus, X } from "lucide-react";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  aliases: string[];
  totalDays: number;
  lastSeen: string | null;
}

function Avatar({ emp, size = "md" }: { emp: Employee; size?: "sm" | "md" }) {
  const name = emp.displayName || emp.name;
  const initials = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";

  if (emp.avatarUrl) {
    return (
      <Image
        src={emp.avatarUrl}
        alt={name}
        width={size === "sm" ? 32 : 40}
        height={size === "sm" ? 32 : 40}
        className={`${dim} rounded-full object-cover ring-2 ring-surface-container-lowest`}
      />
    );
  }
  return (
    <div
      className={`${dim} flex items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container font-bold text-on-primary ring-2 ring-surface-container-lowest`}
    >
      {initials}
    </div>
  );
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal "Nuovo dipendente"
  const [showModal, setShowModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formHireDate, setFormHireDate] = useState("");
  const [formContractType, setFormContractType] = useState("FULL_TIME");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/employees")
      .then((r) => r.json())
      .then(setEmployees)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openModal = () => {
    setFormName("");
    setFormDisplayName("");
    setFormHireDate("");
    setFormContractType("FULL_TIME");
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formName.trim()) {
      setFormError("Il nome è obbligatorio");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          displayName: formDisplayName.trim() || undefined,
          hireDate: formHireDate || undefined,
          contractType: formContractType,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || `Errore ${res.status}`);
        return;
      }
      setShowModal(false);
      load();
    } catch {
      setFormError("Errore di rete");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary">
            Dipendenti
          </h1>
          <p className="mt-1 text-secondary">Elenco completo del personale.</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary shadow-card transition-shadow hover:shadow-elevated"
        >
          <UserPlus className="h-4 w-4" />
          Nuovo dipendente
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">
          Caricamento...
        </div>
      ) : employees.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-card">
          Nessun dipendente trovato. Crea il primo con &quot;Nuovo dipendente&quot; o importa un file WhatsApp.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Dipendente</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Giorni Registrati
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Ultima Presenza
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-b border-surface-container transition-colors hover:bg-surface-container-low/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar emp={emp} />
                      <div>
                        <div className="font-medium text-on-surface">{emp.displayName || emp.name}</div>
                        {emp.displayName && (
                          <div className="text-xs text-on-surface-variant">{emp.name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {emp.totalDays}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {emp.lastSeen ? formatDate(emp.lastSeen) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link
                        href={`/employees/${emp.id}`}
                        className="rounded-md bg-primary-fixed/30 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-fixed/50"
                      >
                        Calendario
                      </Link>
                      <Link
                        href={`/employees/${emp.id}/edit`}
                        className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest"
                      >
                        <Pencil className="mr-0.5 inline h-3.5 w-3.5" />
                        Profilo
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal Nuovo dipendente ─────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          onClick={closeModal}
        >
          <div
            className="mx-4 w-full max-w-md rounded-lg bg-surface-container-lowest p-6 shadow-editorial"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-on-surface flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Nuovo dipendente
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Nome <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  autoFocus
                  placeholder="es. Mario Rossi"
                  className="mt-1 w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/40"
                />
                <p className="mt-1 text-[11px] text-on-surface-variant">
                  Nome &quot;tecnico&quot;, deve corrispondere al nome usato nei messaggi WhatsApp per il match automatico.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Nome visualizzato
                </label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="(opzionale)"
                  className="mt-1 w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant">
                    Data assunzione
                  </label>
                  <input
                    type="date"
                    value={formHireDate}
                    onChange={(e) => setFormHireDate(e.target.value)}
                    className="mt-1 w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant">
                    Tipo contratto
                  </label>
                  <select
                    value={formContractType}
                    onChange={(e) => setFormContractType(e.target.value)}
                    className="mt-1 w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/40"
                  >
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                  </select>
                </div>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-md bg-surface-container px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:shadow-elevated disabled:opacity-50"
                >
                  {submitting ? "Creazione..." : "Crea"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
