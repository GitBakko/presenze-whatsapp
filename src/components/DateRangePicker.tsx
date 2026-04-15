"use client";

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  return (
    <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
      <legend className="sr-only">Intervallo di date</legend>
      <input
        type="date"
        value={from}
        aria-label="Data inizio"
        onChange={(e) => onChange(e.target.value, to)}
        className="rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface shadow-card focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
      />
      <span aria-hidden="true" className="text-sm text-outline-variant">→</span>
      <input
        type="date"
        value={to}
        aria-label="Data fine"
        onChange={(e) => onChange(from, e.target.value)}
        className="rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface shadow-card focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
      />
    </fieldset>
  );
}
