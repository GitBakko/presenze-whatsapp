# UI/UX Audit Report — Hr presenze

**Date:** 2026-04-15
**Scope:** 22 pages + 11 shared components + global styles
**Auditor:** Claude Opus 4.6 (guided by `impeccable:audit` + `impeccable:frontend-design`)

---

## Anti-Patterns Verdict

**Verdict:** ⚠️ Moderate AI-slop tells present — not pervasive, but visible in specific recurring patterns. The underlying design system (Material-3-inspired tokens, Manrope/Inter pairing, tinted neutrals, reduced-motion support) is solid. The issues are **local violations of the system**, not a wrong direction.

**Tells observed:**
- **Gradient primary CTAs** (`bg-gradient-to-br from-primary to-primary-container`) on 9+ buttons — this is the exact "gradient-on-button as sophistication shortcut" pattern the frontend-design skill flags.
- **Avatar initials with gradient background** (`from-primary to-primary-container` + `text-white`) in DashboardShell, EmployeeStatusList, ByEmployeeView, edit pages. Decorative rather than meaningful.
- **Raw semantic palette badges** (`bg-green-100 text-green-800`, `bg-red-100 text-red-800`, `bg-amber-50 text-amber-900`, `bg-violet-100 text-violet-800`) — "generic AI label for status." A shared `StatusBadge` with tokens is the fix.
- **Pure `text-white` and `bg-white`** — pure #fff never appears in nature; should use `bg-surface-container-lowest` and `text-on-primary`.
- **Settings hub card icons in a 9-color rainbow** (indigo/rose/blue/emerald/sky/violet/cyan/amber/teal) — "every card different colour" with no semantic meaning.
- **Login/Register decorative gradient bar + external Google CDN image** as background — gradient-as-decoration anti-pattern plus a third-party CDN dependency for a critical auth page.

**What's right:**
- Typography pairing (Manrope display + Inter body) ✓
- Tokenized OKLCH-ish palette with on-color companions ✓
- `prefers-reduced-motion` globally respected ✓
- Custom `ConfirmProvider` replacing native `confirm` (mostly consistent usage) ✓
- Tinted neutrals (surface colors tint toward brand) ✓

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 52 |
| Medium | 38 |
| Low | 17 |
| **Total** | **110** |

**Top 5 critical/cross-cutting:**

1. **NotificationToast has no `role="status"` / `aria-live="polite"`** → toasts are entirely inaudible to screen readers (C-1)
2. **Sidebar `<nav>` not wrapped in `<ul>`/`<li>`** → screen readers lose list-context (count of items) for primary navigation (C-2)
3. **`<img>` instead of `<Image>` in login/register + external Google CDN URL** as background → no optimization + third-party dependency on auth page (C-3)
4. **Gradient CTA anti-pattern** (9+ instances across pages) — systemic
5. **Raw palette status badges** (20+ instances) — systemic

**Next steps:**
- Apply systemic fixes via `/normalize` + `/harden` (covered below)
- Verify changes don't regress the payroll-import feature just shipped
- Re-run audit before next release

---

## Detailed Findings

### CRITICAL

**C-1. NotificationToast fully inaccessible**
- **File:** `src/components/NotificationToast.tsx`
- **Issue:** No `role="status"`, no `aria-live="polite"`, no entrance/exit animation. Toasts are invisible to screen readers and visually instantaneous (broken motion language).
- **WCAG:** 4.1.3 Status Messages (Level AA)
- **Fix:** Add `role="status" aria-live="polite" aria-atomic="true"` to container; use transform/opacity transition; respect `prefers-reduced-motion`.

**C-2. Primary Sidebar not a list**
- **File:** `src/components/Sidebar.tsx:76`
- **Issue:** `<nav>` contains direct `<Link>` elements — no `<ul>`/`<li>`. AT-announced "list of N items" is lost.
- **WCAG:** 1.3.1 Info and Relationships (Level A)
- **Fix:** Wrap items in `<ul role="list">` + each in `<li>`.

**C-3. Login/Register use external CDN image + `<img>` for logo**
- **Files:** `src/app/login/page.tsx:51,64`, `src/app/register/page.tsx:45,52`
- **Issue:** Auth pages depend on `lh3.googleusercontent.com/...` for background (privacy/availability risk) + bypass `next/image` for logo. If Google CDN hiccups or the URL rotates, login looks broken.
- **Fix:** Move image to `public/login-bg.jpg`, use `<Image>` with proper sizes; remove external fetch.

---

### HIGH SEVERITY (selected — full list in appendix)

**H-1 (systemic). Gradient primary CTA anti-pattern**
- **Files:** `ConfirmProvider.tsx:229`, `FileUpload.tsx:83`, `employees/page.tsx:131,363`, `employees/[id]/edit/page.tsx`, `leaves/page.tsx`, `settings/email-ingest/page.tsx:181`, `settings/schedule/page.tsx:224`, `settings/excluded-names/page.tsx:74`, `reports/page.tsx:79`, `anomalies/page.tsx:390,635`, `login/page.tsx:128`, `register/page.tsx:164`, `settings/payroll-import/page.tsx` (confirm button)
- **Fix:** Replace `bg-gradient-to-br from-primary to-primary-container` → `bg-primary` (or `bg-primary hover:bg-primary-container` for hover), `text-white` → `text-on-primary`.

**H-2 (systemic). `bg-white` instead of `bg-surface-container-lowest`**
- **Files:** DashboardShell.tsx:71, api-keys/page.tsx:119,124,163, payroll-import/page.tsx:277,304, payroll-import/history/page.tsx:62,71, payroll-import/history/[id]/page.tsx:107,142,209, login/page.tsx:74, register/page.tsx:63,84, dashboard StatCard/TodayOverview/AnomalyList/EmployeeStatusList/LeaveBalanceTable/OreChart/AssenzeChart/EmployeeMetricChart, leaves/BalanceCard/CalendarView/ByEmployeeView/RequestsList/CreateLeaveModal/GanttCalendar
- **Fix:** Systematic replace (only on surfaces, not on avatar/text contexts).

**H-3 (systemic). Raw semantic palette status badges**
- **Files:** dashboard components, anomalies, records, api-keys, nfc, telegram, email-ingest, users, leaves/ByEmployeeView
- **Instances:** ~25 color permutations (`bg-{green|red|amber|violet|blue}-{50,100} text-{...}-{700,800,900}`)
- **Fix:** Create `<StatusBadge kind="success|warning|error|info" children />` component; retrofit.

**H-4. Avatar gradient + `text-white`**
- **Files:** DashboardShell.tsx:95, EmployeeStatusList.tsx:60, ByEmployeeView.tsx:97, employees/page.tsx:39, employees/[id]/page.tsx:182, employees/[id]/edit/page.tsx:261
- **Fix:** Replace gradient with flat `bg-primary-container text-on-primary-container` (or solid brand color with tone-aware text).

**H-5. Settings hub rainbow icon colors**
- **File:** `settings/page.tsx:16–101`
- **Issue:** 9 cards each with a random Tailwind hue class (`text-indigo-500`, `text-rose-500`, etc.).
- **Fix:** Use `text-primary` for all, OR introduce a semantic-group palette (communication=tertiary, data=secondary, security=error, automation=success).

**H-6. Raw info banners (amber/sky/violet 50+200+900)**
- **Files:** nfc/page.tsx:189, telegram/page.tsx:217, email-ingest/page.tsx:195, leaves/page.tsx various
- **Fix:** Introduce `<InfoBanner kind="info|warning" icon children />` using tokens.

**H-7. Dashboard StatCard / TodayOverview off-token**
- **File:** `src/components/dashboard/StatCard.tsx:6-11`, `TodayOverview.tsx:13-34`
- **Issue:** `COLOR_MAP` defines 4 hues (green/blue/amber/red) as `bg-{color}-50 text-{color}-700` — same pattern in TodayOverview. All off-token.
- **Fix:** Map to `success / primary-container / warning / error` containers.

**H-8. ConfirmProvider dialog a11y + touch target + gradient**
- **File:** `src/components/ConfirmProvider.tsx:151,166,172,198,207,215,229`
- **Issues:** Missing `aria-labelledby`, `focus:` instead of `focus-visible:`, gradient confirm button, 28px close button.
- **Fix:** Wire `<h2 id>`, use `focus-visible:ring-2`, flat `bg-primary` for confirm, `min-h-[44px] min-w-[44px]` for close.

**H-9. DashboardShell animating layout**
- **File:** `src/components/DashboardShell.tsx:65,71`
- **Issue:** `transition-[width]` and `transition-[margin]` — animating layout triggers layout thrashing.
- **Fix:** Use `translateX` on sidebar + absolute positioning; animate transform only.

**H-10. Sidebar pending badge**
- **File:** `src/components/Sidebar.tsx:98`
- **Issue:** `bg-yellow-400 text-white` — raw palette + pure #fff. Number-only (no `sr-only` label).
- **Fix:** `bg-warning-container text-on-surface`, add `<span class="sr-only">{pending} richieste in attesa</span>`.

**H-11. Records page source badges**
- **File:** `src/app/(dashboard)/records/page.tsx:289–292,369–375,422,464`
- **Fix:** Use StatusBadge; `bg-primary text-on-primary` for active state.

**H-12. Anomalies page raw amber + gradient buttons**
- **File:** `src/app/(dashboard)/anomalies/page.tsx:357,362,390,400,635`

**H-13. Login/Register decorative gradient bar + pure white card**
- **Files:** login/page.tsx:74,128,161; register/page.tsx:63,84,164
- **Fix:** Remove decorative gradient bar; flat card with `bg-surface-container-lowest/90 backdrop-blur-md`; flat button.

---

### MEDIUM SEVERITY (selected)

**M-1. Missing `aria-label` on icon-only buttons**
- **Files:** nfc (Trash2), telegram (Trash2), email-ingest (Trash2), api-keys (Trash2), records (Pencil, Trash2), anomalies (X close, action buttons), CalendarView (prev/next month), RequestsList (approve/reject), CreateLeaveModal (X close), DashboardShell (userMenu trigger)
- **Fix:** Add `aria-label="Elimina"` / `"Precedente"` / etc. on every icon-only button.

**M-2. Missing `scope="col"` on table headers**
- **Files:** records, reports, anomalies, LeaveBalanceTable, schedule
- **Fix:** Global sweep — add `scope="col"` to every `<th>`.

**M-3. Touch targets < 44px**
- **Files:** NotificationToast dismiss (~20px), ConfirmProvider close/cancel (~28/36px), edit/trash buttons in tables (~28px), NotificationBell trigger (~40px), EmptyState action (~36px), CalendarView day events (~18px)
- **Fix:** `min-h-[44px] min-w-[44px]` on pure-icon buttons; increase padding on compact buttons.

**M-4. No dirty-state warning on edit forms**
- **Files:** employees/[id]/edit, settings/schedule
- **Fix:** `useBeforeUnload(formIsDirty)` hook + `router.events` listener.

**M-5. Loading/error state gaps**
- **Files:** settings/schedule `handleSave` (no error), settings/excluded-names (handleDelete silently swallows), email-ingest handleIgnore (no loading), api-keys handleCreate (non-OK silently dropped)

**M-6. ConfirmProvider dismiss on backdrop for danger dialogs**
- **File:** `src/components/ConfirmProvider.tsx:146`
- **Fix:** `onClick` on backdrop → no-op if `opts.danger`.

**M-7. `useEffect` fetch dependencies**
- **File:** `settings/schedule/page.tsx:46` — re-fetches employees list every selection change
- **Fix:** `useEffect(..., [])` for initial load, separate useEffect for schedule.

**M-8. Breadcrumb missing `aria-current="page"` on last item**
- **File:** `src/components/Breadcrumb.tsx`
- **Fix:** Add on last-item `<span>`.

**M-9. `useModalA11y` hook not universally applied**
- **Files:** anomalies ResolutionPanelOverlay lacks `role="dialog"`.

**M-10. Form inputs without `htmlFor`/`id`**
- **Files:** `employees/page.tsx` modal inputs (288–337), login/register, various settings

---

### LOW SEVERITY (selected)

- **L-1.** `key={i}` patterns in calendar/gantt rendering (potential re-render issues)
- **L-2.** `<img>` on Sidebar logo (acceptable for SVG)
- **L-3.** Inline `style={{ minWidth: 120 }}` where `min-w-[120px]` would work
- **L-4.** Duplicate `disabled:cursor-not-allowed` in FileUpload
- **L-5.** `h-screen` should be `h-dvh` for iOS Safari chrome handling
- **L-6.** No skip-link in `app/layout.tsx`
- **L-7.** Breadcrumb nav label collides with sidebar — rename to `aria-label="Breadcrumb"`
- **L-8.** `register/page.tsx` dead `router` import (suppressed with `void`)

---

## Patterns & Systemic Issues

1. **Design token drift (52 instances)** — a shared vocabulary (`bg-white` / `text-blue-600` / `bg-green-100 text-green-800`) creeps in when the dev is coding against mental-model Tailwind rather than the project's `@theme` tokens. Needs a lint rule or a "tokens cheatsheet" in CONTRIBUTING.md.

2. **Gradient as "importance" (9 instances)** — gradient `bg-gradient-to-br from-primary to-primary-container` is used as "this button matters" but dilutes the primary CTA by making every primary button visually similar. Flat `bg-primary` is more distinctive.

3. **Icon-only buttons without labels (18 instances)** — consistent pattern: `<button><Trash2/></button>` with only `title`. Screen reader hostile.

4. **Status color vocabulary inconsistent** — each page invents its own green-50/700 / red-100/800 / amber-100/800. No shared `StatusBadge` component.

5. **Table `<th>` without `scope`** — all 6 tables in the app.

---

## Positive Findings

- `src/app/globals.css` is well-structured — comprehensive Material-3-inspired tokens, `prefers-reduced-motion` global, tinted neutrals.
- `ConfirmProvider` replaces native `confirm` across the app (only my payroll-import had `window.confirm`, now fixed).
- `useModalA11y` hook provides focus trap + escape key handling centrally.
- Sonner toasts are used correctly for transient feedback.
- Payroll-import PDF upload uses drag-and-drop dropzone with design tokens (after normalize pass).
- Reduced-motion CSS globally disables animations — accessibility default done right.
- Font loading strategy (Manrope + Inter with `display: swap`) is correct.

---

## Recommendations by Priority

### Immediate (this session)
- C-1 to C-3 (3 critical blockers)
- H-1: gradient CTA sweep (9 pages)
- H-2: `bg-white` → surface-container-lowest sweep
- H-3: StatusBadge shared component + retrofit dashboard + settings
- H-8: ConfirmProvider hardening
- H-9: DashboardShell transform-based animation + skip-link
- H-10: Sidebar semantic + pending badge

### Short-term (next sprint)
- H-4/H-5/H-6/H-7 (token drift remainders)
- M-1/M-2 (aria-labels + scope)
- M-3 (touch targets ≥ 44px)
- M-4 (dirty-state warning on edit forms)
- M-5 (error/loading state gaps)

### Medium-term
- M-6 to M-10 (refinements)
- Replace `<img>` avatars with `<Image>` (privacy-free local fallback)
- Introduce `<SectionHeader>` + `<PageHeader>` components to enforce heading hierarchy

### Long-term
- Dark mode variant (tokens have `inverse-surface` but dark theme unused)
- Container queries for component-level responsiveness
- L-* items

---

## Commands to Apply Fixes

- `/normalize` — addresses H-1 through H-11 (~40 issues)
- `/harden` — addresses C-1, M-1 through M-5 (~20 issues)
- `/optimize` — addresses L-1, L-5, perf hotspots (~8 issues)
- `/polish` — addresses M-3 (touch targets), M-8 (aria-current), L-* refinements

---

## Appendix: Full Finding List by File

(See raw agent outputs for complete per-file listings; summarized above in Detailed Findings.)
