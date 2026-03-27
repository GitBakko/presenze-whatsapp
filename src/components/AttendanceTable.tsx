import { hoursToHHMM, minutesToHHMM, formatDate } from "@/lib/formatTime";

interface DailyStat {
  employeeName: string;
  date: string;
  entries: string[];
  exits: string[];
  hoursWorked: number;
  pauseMinutes: number;
  morningDelay: number;
  afternoonDelay: number;
  overtime: number;
  hasAnomaly: boolean;
  anomalies: { type: string; description: string }[];
}

export function AttendanceTable({ data }: { data: DailyStat[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg bg-surface-container-lowest p-8 text-center text-on-surface-variant shadow-card">
        Nessun dato di presenza trovato per il periodo selezionato.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-surface-container bg-surface-container-low">
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Dipendente
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Data
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Mattina
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Pomeriggio
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Ore
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Pausa
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Ritardo
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Straord.
            </th>
            <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
              Stato
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const totalDelay = row.morningDelay + row.afternoonDelay;
            const anomalyDesc = row.anomalies?.map((a) => a.description).join("; ") ?? "";
            const morning = row.entries[0] || row.exits[0]
              ? `${row.entries[0] ?? "?"} – ${row.exits[0] ?? "?"}`
              : null;
            const afternoon = row.entries[1] || row.exits[1]
              ? `${row.entries[1] ?? "?"} – ${row.exits[1] ?? "?"}`
              : null;
            return (
              <tr
                key={i}
                className="border-b border-surface-container transition-colors hover:bg-surface-container-low/50"
              >
                <td className="px-4 py-3 font-medium text-on-surface">{row.employeeName}</td>
                <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                  {formatDate(row.date)}
                </td>
                <td className="px-4 py-3 tabular-nums text-on-surface">
                  {morning ?? <span className="text-outline-variant">-</span>}
                </td>
                <td className="px-4 py-3 tabular-nums text-on-surface">
                  {afternoon ?? <span className="text-outline-variant">-</span>}
                </td>
                <td className="px-4 py-3 tabular-nums font-medium text-on-surface">
                  {hoursToHHMM(row.hoursWorked)}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.pauseMinutes > 0 ? (
                    <span className="text-tertiary">{minutesToHHMM(row.pauseMinutes)}</span>
                  ) : (
                    <span className="text-outline-variant">-</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {totalDelay > 0 ? (
                    <span className="text-warning">{minutesToHHMM(totalDelay)}</span>
                  ) : (
                    <span className="text-outline-variant">-</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.overtime > 0 ? (
                    <span className="font-bold text-primary">
                      +{hoursToHHMM(row.overtime)}
                    </span>
                  ) : (
                    <span className="text-outline-variant">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.hasAnomaly ? (
                    <span
                      className="inline-flex items-center rounded-full bg-error-container px-2.5 py-0.5 text-xs font-medium text-on-error-container"
                      title={anomalyDesc}
                    >
                      Anomalia
                    </span>
                  ) : totalDelay > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-warning-container px-2.5 py-0.5 text-xs font-medium text-warning">
                      Ritardo
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-success-container px-2.5 py-0.5 text-xs font-medium text-success">
                      Regolare
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
