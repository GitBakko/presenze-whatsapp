"use client";
import { useEffect, useState } from "react";

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
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Storico import paghe</h1>
        <a href="/settings/payroll-import" className="text-sm text-blue-600 hover:underline">
          ← Nuovo import
        </a>
      </div>
      {loading && <p>Caricamento…</p>}
      {!loading && items.length === 0 && (
        <p className="text-gray-500">Nessun import ancora.</p>
      )}
      {items.length > 0 && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Utente</th>
              <th className="px-3 py-2">Tabulato</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2 text-right">Aggiornati</th>
              <th className="px-3 py-2 text-right">Orfani</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2">{new Date(i.createdAt).toLocaleString("it-IT")}</td>
                <td className="px-3 py-2">{i.userName}</td>
                <td className="px-3 py-2">{i.sourceMonth}</td>
                <td className="px-3 py-2 text-xs font-mono">{i.fileName}</td>
                <td className="px-3 py-2 text-right">
                  {i.matchedEmployees}/{i.totalEmployees}
                </td>
                <td className="px-3 py-2 text-right">{i.orphanEmployees}</td>
                <td className="px-3 py-2">
                  <a
                    href={`/settings/payroll-import/history/${i.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    Dettagli
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
