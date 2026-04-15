"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, History } from "lucide-react";

interface Item {
  id: string;
  createdAt: string;
  userName: string;
  fileName: string;
  year: number;
  sourceMonth: string;
  totalEmployees: number;
  matchedEmployees: number;
  orphanEmployees: number;
}

export default function PayrollImportHistoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/payroll-import/history")
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/payroll-import"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Nuovo import
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" strokeWidth={1.5} />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
          Storico import paghe
        </h1>
      </div>
      <p className="text-sm text-on-surface-variant">
        Archivio di tutti gli import del tabulato ferie/permessi. Apri un
        dettaglio per confrontare i saldi prima e dopo l&apos;import per
        ciascun dipendente.
      </p>

      {loading && (
        <p className="text-sm text-on-surface-variant">Caricamento…</p>
      )}

      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/30 bg-white py-12 text-center">
          <History className="mb-3 h-12 w-12 text-outline-variant" strokeWidth={1.5} />
          <p className="text-sm text-on-surface-variant">
            Nessun import ancora eseguito
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low/50">
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                  Data
                </th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                  Utente
                </th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                  Tabulato
                </th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                  File
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                  Aggiornati
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                  Orfani
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {items.map((i) => (
                <tr
                  key={i.id}
                  className="transition-colors hover:bg-surface-container-low/50"
                >
                  <td className="px-4 py-3 text-on-surface">
                    {new Date(i.createdAt).toLocaleString("it-IT")}
                  </td>
                  <td className="px-4 py-3 text-on-surface">{i.userName}</td>
                  <td className="px-4 py-3 font-semibold text-on-surface">
                    {i.sourceMonth}
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    <span className="font-mono">{i.fileName}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-on-surface">
                    {i.matchedEmployees}/{i.totalEmployees}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-on-surface-variant">
                    {i.orphanEmployees}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/settings/payroll-import/history/${i.id}`}
                      className="text-sm font-semibold text-primary hover:text-primary-container"
                    >
                      Dettagli →
                    </Link>
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
