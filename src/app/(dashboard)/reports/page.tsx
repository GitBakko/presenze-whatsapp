"use client";

import { useEffect, useState } from "react";
import { hoursToHHMM, minutesToHHMM } from "@/lib/formatTime";
import { Download } from "lucide-react";

interface EmployeeReport {
  employeeId: string;
  employeeName: string;
  totalDays: number;
  totalHours: number;
  averageHours: number;
  totalDelays: number;
  totalOvertime: number;
  totalPauseMinutes: number;
  anomalies: number;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`,
  };
}

export default function ReportsPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<EmployeeReport[]>([]);
  const [loading, setLoading] = useState(true);

  const range = (() => {
    const [y, m] = month.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
    return { from, to };
  })();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const handleExport = (format: "csv" | "xlsx") => {
    window.open(
      `/api/export?from=${range.from}&to=${range.to}&format=${format}`,
      "_blank"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Report Mensile</h1>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/20"
          />
          <button
            onClick={() => handleExport("csv")}
            className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-medium text-primary shadow-card transition-shadow hover:shadow-elevated"
          >
            <Download className="mr-1 inline h-4 w-4" /> CSV
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            className="rounded-lg bg-surface-container-low px-3 py-2 text-sm font-medium text-primary shadow-card transition-shadow hover:shadow-elevated"
          >
            <Download className="mr-1 inline h-4 w-4" /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">
          Caricamento...
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest shadow-card p-8 text-center text-on-surface-variant">
          Nessun dato trovato per il mese selezionato.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Dipendente
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Giorni
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Ore Totali
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Pausa Tot.
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Media Ore/Giorno
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Ritardi
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Straordinario
                </th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Anomalie
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((emp) => (
                <tr
                  key={emp.employeeId}
                  className="border-b border-surface-container transition-colors hover:bg-surface-container-low/50"
                >
                  <td className="px-4 py-3 font-medium">{emp.employeeName}</td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {emp.totalDays}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {hoursToHHMM(emp.totalHours)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {emp.totalPauseMinutes > 0 ? (
                      <span className="text-tertiary">{minutesToHHMM(emp.totalPauseMinutes)}</span>
                    ) : (
                      <span className="text-outline-variant">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {hoursToHHMM(emp.averageHours)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {emp.totalDelays > 0 ? (
                      <span className="text-warning">
                        {emp.totalDelays} giorni
                      </span>
                    ) : (
                      <span className="text-outline-variant">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {emp.totalOvertime > 0 ? (
                      <span className="text-primary">
                        +{hoursToHHMM(emp.totalOvertime)}
                      </span>
                    ) : (
                      <span className="text-outline-variant">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {emp.anomalies > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-error-container px-2.5 py-0.5 text-xs font-medium text-on-error-container">
                        {emp.anomalies}
                      </span>
                    ) : (
                      <span className="text-outline-variant">-</span>
                    )}
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
