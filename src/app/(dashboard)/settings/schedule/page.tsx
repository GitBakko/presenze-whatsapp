"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
}

interface ScheduleEntry {
  id: string;
  employeeId: string;
  employee: string;
  dayOfWeek: number;
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
}

const DAY_NAMES = ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"];

export default function SchedulePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [, setSchedule] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Local edit state: dayOfWeek -> { block1Start, block1End, block2Start, block2End }
  const [editState, setEditState] = useState<Record<number, {
    block1Start: string; block1End: string; block2Start: string; block2End: string;
  }>>({});

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((emps: Employee[]) => {
        const sorted = emps.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
        setEmployees(sorted);
        if (sorted.length > 0 && !selectedEmpId) setSelectedEmpId(sorted[0].id);
      })
      .finally(() => setLoading(false));
  }, [selectedEmpId]);

  const loadSchedule = useCallback(() => {
    if (!selectedEmpId) return;
    fetch(`/api/schedule?employeeId=${selectedEmpId}`)
      .then((r) => r.json())
      .then((entries: ScheduleEntry[]) => {
        setSchedule(entries);
        // Initialize edit state
        const state: typeof editState = {};
        for (let d = 1; d <= 5; d++) {
          const entry = entries.find((e) => e.dayOfWeek === d);
          if (entry) {
            state[d] = {
              block1Start: entry.block1Start ?? "",
              block1End: entry.block1End ?? "",
              block2Start: entry.block2Start ?? "",
              block2End: entry.block2End ?? "",
            };
          } else {
            state[d] = {
              block1Start: "09:00",
              block1End: "13:00",
              block2Start: "14:30",
              block2End: "18:30",
            };
          }
        }
        setEditState(state);
      });
  }, [selectedEmpId]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const handleSave = async () => {
    setSaving(true);
    const promises = Object.entries(editState).map(([dayStr, blocks]) => {
      const dayOfWeek = Number(dayStr);
      return fetch("/api/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedEmpId,
          dayOfWeek,
          block1Start: blocks.block1Start || null,
          block1End: blocks.block1End || null,
          block2Start: blocks.block2Start || null,
          block2End: blocks.block2End || null,
        }),
      });
    });
    await Promise.all(promises);
    setSaving(false);
    loadSchedule();
  };

  const updateDay = (day: number, field: string, value: string) => {
    setEditState((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const clearAfternoon = (day: number) => {
    setEditState((prev) => ({
      ...prev,
      [day]: { ...prev[day], block2Start: "", block2End: "" },
    }));
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-outline-variant">Caricamento...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings" className="text-primary hover:text-primary-container text-sm">
          ← Impostazioni
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Orari Dipendenti</h1>
      </div>

      <p className="text-sm text-on-surface-variant">
        Configura gli orari lavorativi per ogni dipendente e giorno della settimana.
        Lascia vuoto il blocco pomeridiano per i giorni con solo turno mattutino.
      </p>

      {employees.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest shadow-card p-8 text-center text-outline-variant">
          Nessun dipendente trovato. Importa prima i dati.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.displayName || e.name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-container bg-surface-container-low">
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Giorno</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Mattina Inizio</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Mattina Fine</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Pomeriggio Inizio</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Pomeriggio Fine</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant"></th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((day) => {
                  const d = editState[day];
                  if (!d) return null;
                  return (
                    <tr key={day} className="border-b border-surface-container">
                      <td className="px-4 py-3 font-medium">{DAY_NAMES[day]}</td>
                      <td className="px-4 py-3">
                        <input
                          type="time"
                          value={d.block1Start}
                          onChange={(e) => updateDay(day, "block1Start", e.target.value)}
                          className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="time"
                          value={d.block1End}
                          onChange={(e) => updateDay(day, "block1End", e.target.value)}
                          className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="time"
                          value={d.block2Start}
                          onChange={(e) => updateDay(day, "block2Start", e.target.value)}
                          className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="time"
                          value={d.block2End}
                          onChange={(e) => updateDay(day, "block2End", e.target.value)}
                          className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {d.block2Start && (
                          <button
                            onClick={() => clearAfternoon(day)}
                            className="rounded bg-surface-container px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high"
                            title="Solo mattina"
                          >
                            Solo AM
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gradient-to-br from-primary to-primary-container px-6 py-2 text-sm font-medium text-on-primary hover:shadow-elevated disabled:opacity-50"
          >
            {saving ? "Salvataggio..." : "Salva Orari"}
          </button>
        </>
      )}
    </div>
  );
}
