# Dashboard Card Layout + Anomaly Filter — Design Spec

**Date:** 2026-04-16
**Author:** Stefano Brunelli (brainstormed with Claude)
**Status:** Draft — awaiting review

---

## 1. Goal

Three changes to the dashboard:

1. Rename the upcoming leaves box to "Ferie & permessi prossimi 14 giorni".
2. Convert 4 panels from vertical lists to responsive grids of compact cards (2–3 per row on desktop), each employee/anomaly in a rounded-corner box — making the dashboard denser and more scannable.
3. Exclude today's anomalies from both the count (TodayOverview) and the list (AnomalyList), renaming to "Anomalie da verificare", to avoid false-positive noise from same-day punches that auto-resolve by evening.

---

## 2. Affected components

| Component | Changes |
|---|---|
| `UpcomingLeavesBox.tsx` | Title rename only |
| `TodayLeavesBox.tsx` | Card grid layout |
| `UpcomingLeavesBox.tsx` | Card grid layout |
| `EmployeeStatusList.tsx` | Card grid layout |
| `AnomalyList.tsx` | Card grid layout + title rename + filter change |
| `TodayOverview.tsx` | "Anomalie aperte" → "Anomalie da verificare" + sub-text change |
| `dashboard/route.ts` | Anomaly queries: `date: today` → `date: { lt: today }, resolved: false` |
| `src/types/dashboard.ts` | No changes (types remain the same) |

---

## 3. Card grid layout (all 4 panels)

### Container

Each panel keeps its existing wrapper (`rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card`) with header (icon + title + count badge). The inner content changes from `<ul> space-y-3` to:

```
grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3
```

Still wrapped in `max-h-80 overflow-y-auto` for scroll when many items.

### Card base style (shared)

```
rounded-xl bg-surface-container-low/50 border border-outline-variant/20 p-3
```

Lightweight, tinted, not a heavy container — avoids the "nested cards" anti-pattern by using a very subtle tint + thin border, clearly subordinate to the parent panel.

### Card content per panel

**TodayLeavesBox card:**
```
┌──────────────────────────┐
│ [SB] Nome Dipendente     │  ← avatar initials circle + name bold
│ 🏷 Ferie                 │  ← StatusBadge (type)
│ fino al 25 Aprile        │  ← temporal detail text-xs
└──────────────────────────┘
```
- Avatar initials: `w-7 h-7` (slightly smaller than current 8 to fit card)
- Name: `text-sm font-semibold text-on-surface truncate`
- Badge: `<StatusBadge>` (info/warning/neutral)
- Detail: `text-xs text-on-surface-variant`

**UpcomingLeavesBox card:** identical structure, different detail text (date range).

**EmployeeStatusList card:**
```
┌──────────────────────────┐
│ [SB] Nome Dipendente  🟢 │  ← avatar + name + status dot with label
│ Ingresso 08:42           │  ← last punch time or "Non timbrato"
│ Ritardo: 12 min          │  ← delay/overtime if present, text-xs
└──────────────────────────┘
```
- Status dot: inline after name with sr-only label
- First punch time: `text-xs text-on-surface-variant`
- Delay/overtime: `text-xs` in warning/success color, only if nonzero

**AnomalyList card:**
```
┌──────────────────────────┐
│ Nome Dipendente          │  ← name bold
│ 🏷 MISSING_EXIT  14 Apr │  ← type badge + date
│ Uscita mancante per...   │  ← description truncated, text-xs
└──────────────────────────┘
```
- No avatar (anomaly is the subject)
- Severity badge: `<StatusBadge kind="error|warning|info">`
- Date: `text-xs text-on-surface-variant` inline with badge
- Description: `text-xs text-on-surface-variant line-clamp-2`

---

## 4. Anomaly filter change

### API (`src/app/api/stats/dashboard/route.ts`)

Current queries for anomaly count (TodayOverview):
```ts
prisma.anomaly.count({ where: { resolved: false, date: today } })
```

Change to:
```ts
prisma.anomaly.count({ where: { resolved: false, date: { lt: today } } })
```

This counts unresolved anomalies from **yesterday and earlier** — today's are excluded because they're likely false positives from incomplete same-day punches.

The `recentAnomalies` query (for AnomalyList) currently fetches unresolved anomalies ordered by date desc. Add a `date: { lt: today }` filter:
```ts
prisma.anomaly.findMany({
  where: { resolved: false, date: { lt: today } },
  ...
})
```

### TodayOverview

- Card title: "Anomalie aperte" → **"Anomalie da verificare"**
- Sub-text: "da verificare oggi" → **"dai giorni precedenti"**

### AnomalyList

- Title: "Anomalie recenti" → **"Anomalie da verificare"**

---

## 5. Non-goals

- No click-through from cards to detail pages (future).
- No drag-to-reorder or card collapse.
- No animation on card appearance (keep it snappy).
- No change to the KPI "% anomalie risolte" calculation (that uses period-based queries, unaffected).
- No change to the anomalies page (`/anomalies`) — only the dashboard boxes.
