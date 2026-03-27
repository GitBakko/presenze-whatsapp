"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/formatTime";
import { Pencil } from "lucide-react";

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
      <img
        src={emp.avatarUrl}
        alt={name}
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

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then(setEmployees)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary">
          Dipendenti
        </h1>
        <p className="mt-1 text-secondary">Elenco completo del personale.</p>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">
          Caricamento...
        </div>
      ) : employees.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-card">
          Nessun dipendente trovato. Importa un file WhatsApp per iniziare.
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
    </div>
  );
}
