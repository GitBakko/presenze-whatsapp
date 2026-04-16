# Dashboard Leave Boxes — Design Spec

**Date:** 2026-04-16
**Author:** Stefano Brunelli (brainstormed with Claude)
**Status:** Draft — awaiting review

---

## 1. Goal

Add two side-by-side boxes to the dashboard, positioned immediately below `TodayOverview`, that show **who** is on leave — not just how many. The admin currently sees "2 in ferie · 1 malattia" as aggregate counts; the new boxes turn those numbers into named, actionable lists.

**Success criteria:**
1. Box "Oggi" lists every employee with an approved leave overlapping today, with type and temporal detail.
2. Box "Prossimi 14 giorni" lists every employee with an approved leave starting from tomorrow through today+14, with date range.
3. No duplicates: a leave spanning today and the future appears only in "Oggi".
4. Empty states render a discrete inline message, not a hidden box.
5. Date/time strings are in extended Italian: "dal 23 Marzo al 03 Aprile", "dalle 9:00 alle 12:30".

---

## 2. Data source

### Query

A single `prisma.leaveRequest.findMany` with:
- `status: "APPROVED"`
- `startDate <= today+14` AND `endDate >= today`
- `include: { employee: { select: { id, name, displayName } } }`

Split server-side into two arrays:
- **todayLeaves**: `startDate <= today AND endDate >= today`
- **upcomingLeaves**: `startDate > today AND startDate <= today+14`

### API change

Extend the existing `GET /api/stats/dashboard` response with two new fields:

```ts
todayLeaves: LeaveListItem[];
upcomingLeaves: LeaveListItem[];

interface LeaveListItem {
  employeeId: string;
  employeeName: string;   // displayName ?? name
  type: string;           // VACATION | VACATION_HALF_AM | VACATION_HALF_PM | ROL | SICK | BEREAVEMENT | MARRIAGE | LAW_104 | MEDICAL_VISIT
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  hours: number | null;
  timeSlots: string | null; // raw JSON string from DB
}
```

No new endpoints. No new DB models. No new dependencies.

### Sorting

- **todayLeaves**: by `employee.name` ascending (alphabetical — predictable).
- **upcomingLeaves**: by `startDate` ascending, then `employee.name` (soonest first).

---

## 3. Components

### 3.1 `TodayLeavesBox`

**File:** `src/components/dashboard/TodayLeavesBox.tsx`

**Props:**
```ts
interface TodayLeavesBoxProps {
  leaves: LeaveListItem[];
}
```

**Render:**
- Card wrapper: `bg-surface-container-lowest shadow-card rounded-xl border border-outline-variant/30 p-4`
- Header: icon `CalendarCheck` (lucide) + "Ferie & permessi oggi" + count badge (`<StatusBadge kind="info">{leaves.length}</StatusBadge>`)
- Body: list of rows, `max-h-80 overflow-y-auto` if > ~6 items.
- Each row:
  - Avatar initials circle: `bg-primary-container text-on-primary-container` (flat, 32px, font-bold text-xs)
  - **Employee name** (`text-sm font-semibold text-on-surface`)
  - Leave type as `<StatusBadge>`:
    - VACATION / VACATION_HALF_AM / VACATION_HALF_PM → kind `info`, label from `LEAVE_TYPES[type].label`
    - SICK → kind `warning`
    - ROL / BEREAVEMENT / MARRIAGE / LAW_104 / MEDICAL_VISIT → kind `neutral`
  - Temporal detail (`text-xs text-on-surface-variant`): see §4.
- Empty: `<p class="text-sm text-on-surface-variant py-4 text-center">Nessuna assenza oggi</p>`

### 3.2 `UpcomingLeavesBox`

**File:** `src/components/dashboard/UpcomingLeavesBox.tsx`

**Props:**
```ts
interface UpcomingLeavesBoxProps {
  leaves: LeaveListItem[];
}
```

**Render:** identical card structure as `TodayLeavesBox` except:
- Icon: `CalendarClock`
- Title: "Prossimi 14 giorni"
- Temporal detail: date range format (§4) instead of "fino al / solo oggi".
- Empty: `<p>Nessuna assenza pianificata</p>`

### 3.3 Dashboard layout change

**File:** `src/app/(dashboard)/page.tsx`

Insert the 2-column grid between `TodayOverview` and `KpiGrid` (Section A → new → Section B):

```tsx
{/* Leave detail boxes */}
{data && isAdmin && (
  <div className="grid gap-4 lg:grid-cols-2">
    <TodayLeavesBox leaves={data.todayLeaves} />
    <UpcomingLeavesBox leaves={data.upcomingLeaves} />
  </div>
)}
```

Visible only for admin (consistent with `TodayOverview`).

---

## 4. Date/time formatting

**Helper:** `formatLeaveDetail(leave: LeaveListItem, context: "today" | "upcoming"): string`

**File:** add to `src/components/dashboard/TodayLeavesBox.tsx` (or extract to a shared `leave-format.ts` if both boxes import it).

### Rules for context "today"

| Condition | Output |
|---|---|
| `type` is `VACATION_HALF_AM` | `"mattina"` |
| `type` is `VACATION_HALF_PM` | `"pomeriggio"` |
| `startDate === endDate === today` (single day) | `"solo oggi"` |
| `endDate > today` (multi-day, ongoing) | `"fino al 25 Aprile"` |
| `timeSlots` present and parseable | `"dalle 9:00 alle 12:30"` (from first slot) |
| fallback | `"oggi"` |

### Rules for context "upcoming"

| Condition | Output |
|---|---|
| `type` is `VACATION_HALF_AM` | `"il 22 Aprile, mattina"` |
| `type` is `VACATION_HALF_PM` | `"il 22 Aprile, pomeriggio"` |
| `startDate === endDate` (single day, no timeSlots) | `"il 22 Aprile"` |
| `startDate !== endDate` (multi-day) | `"dal 21 Aprile al 25 Aprile"` |
| `timeSlots` present | `"il 22 Aprile, dalle 9:00 alle 11:00"` |
| fallback | `"il {startDate}"` |

### Month names

```ts
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
              "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
```

Format: `DD Mese` (no leading zero on day: "3 Aprile" not "03 Aprile").

### Time format

From `timeSlots` JSON: `[{"from":"09:00","to":"12:30"}]` → "dalle 9:00 alle 12:30".
If multiple slots exist (rare), use only the first for display.
Strip leading zero on hour: "9:00" not "09:00".

---

## 5. Avatar initials

Reuse the existing avatar-initials pattern from `EmployeeStatusList`:
- Take first letter of first name + first letter of last name (from `employeeName.split(" ")`).
- Circle: `w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-bold`.
- No gradient, no `<Image>` (the leave list doesn't have avatar URLs in the response — keeping it light).

---

## 6. Non-goals

- No click-through to employee detail or leave detail (future enhancement).
- No filtering/search within the boxes.
- No real-time updates (refreshes with dashboard period filter, same as all other boxes).
- No notification/alert when a new leave starts.
- No consideration of non-approved leaves.
- No avatar images (just initials).
