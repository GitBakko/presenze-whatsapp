# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Presenze WhatsApp** — an Italian SME attendance/HR system. Employees clock in/out via WhatsApp group messages (`Entrata 09:00`, `Uscita 18:30`, `Pausa 13:00 - 14:00`); the app parses the chat export, computes worked hours / delays / overtime, detects anomalies, and manages leave (ferie/ROL/malattia per **CCNL Commercio**). Attendance also arrives via NFC kiosk, Telegram bot, manual entry, and an email-to-leaves ingest. UI and most domain strings are **Italian**.

Single-tenant, runs on a **single LAN Windows Server behind IIS** (ARR reverse proxy). Not serverless — in-process singletons and background workers are load-bearing (see Gotchas).

## Commands

```bash
npm run dev          # dev server (Turbopack)
npm run build        # production build → .next/standalone/ (output: "standalone")
npm start            # run production server
npm run lint         # eslint src/
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watch
npx vitest run src/lib/calculator.test.ts   # single test file
npx vitest run -t "overtime"                 # single test by name
npm run db:push      # sync Prisma schema → SQLite (see Gotchas: NO migrations)
npm run db:studio    # Prisma Studio GUI
npm run db:generate  # regenerate Prisma Client (run after editing schema.prisma)
```

Always run `npm run build && npm test` before committing.

## Gotchas (non-obvious, read before editing)

- **Schema changes use `npm run db:push`, NOT `prisma migrate`.** There is no `migrations/` dir; the SQLite DB is synced by push. After editing `prisma/schema.prisma`, run `db:generate`.
- **In-process singletons MUST be anchored on `globalThis`** (see `src/lib/db.ts`, `src/lib/notifications-bus.ts`). Next.js standalone splits modules across chunks → module-scoped state silently duplicates. Never hold shared registries/caches/buses in module scope.
- **Background workers boot from `src/instrumentation.ts`** (`register()`, nodejs runtime only): mail-ingest poller (Graph API), WebSocket notification server, monthly-report worker. Adding a server-lifetime worker means wiring it here.
- **Real-time notifications run over a dedicated WebSocket port** (`WS_PORT`, default 3101), not SSE — IIS/ARR buffers SSE. `notifications-bus.ts` is an in-memory pub/sub + ring buffer (ephemeral; cleared on restart). Employees receive only their own whitelisted self-events; admins receive all.
- **`LeaveBalance.*Accrued` / `*Used` columns are ignored** — accrual and usage are **recomputed dynamically** from records/leaves at read time (`src/lib/leaves/balance.ts`). Only `*CarryOver` and `*AccrualAdjust` are authoritative manual inputs (payslip realignment).
- **Pauses are NOT subtracted from worked hours** — `hoursWorked` = full ENTRY→EXIT span (`calculator.ts`). Overtime = worked minutes exceeding the employee's contracted schedule; explicit `OVERTIME_START/END` blocks are informational only.
- **Times/dates are stored as strings** (`"HH:MM"`, `"YYYY-MM-DD"`), not `DateTime`, to dodge timezone drift. Locale is Europe/Rome; use `tz.ts` / `date-utils.ts` for conversions — don't reach for raw `new Date()` on these.
- **Import is idempotent** via `AttendanceRecord @@unique([employeeId, date, type, declaredTime])` — re-importing a chat silently skips dupes.
- **Prod env vars live in NSSM `AppEnvironmentExtra`, not `.env`.** Deploy is delicate (IIS physical-path subdir + `uploads/` must survive a publish). Treat prod actions as high-risk.

## Architecture

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Prisma 6 + SQLite · NextAuth v5 (JWT/Credentials) · Tailwind 4 · Recharts · ExcelJS · vitest.

**Request flow / layers:**
- `src/app/(dashboard)/**` — protected admin UI (route group). `src/app/api/**` — API routes.
- `src/middleware.ts` — gates everything to *logged-in + active*; sets the public-route allowlist (login, register, `api/auth`, `api/kiosk`, `api/external`, `api/employee-portal`, `api/telegram/webhook`) and does a same-origin CSRF check (via `X-Forwarded-Host`, behind ARR) on mutating methods.
- **Authorization is per-route**, not in middleware: `checkAuth()` (admin-only), `checkAuthAny()` (any active user), `resolveEmployeeId()` in `src/lib/auth-guard.ts`.
- **Two auth schemes:** NextAuth JWT cookie for the UI; SHA-256-hashed API keys for machine access — global `ApiKey` (`Authorization: Bearer`, used by `/api/external` + `/api/kiosk`, see `api-key-auth.ts`) and per-employee `EmployeeApiKey` (`/api/employee-portal`, see `employee-api-key-auth.ts`).

**Domain core (`src/lib/`):**
- `parser.ts` — WhatsApp `.txt` → structured records (state machine per employee/day: handles `fine`, `Pausa come <name>`, `+N minuti`, time-format variants, excluded names).
- `calculator.ts` — per-day hours / delays / overtime / anomalies from records + the employee's `EmployeeSchedule`.
- `anomaly-sync.ts` — reconciles computed anomalies with the `Anomaly` table.
- `kiosk-classifier.ts` — turns an NFC punch into the right ENTRY/EXIT/PAUSE type from current day state.
- `leaves/` — barrel module (`balance`, `working-days`, `holidays`, `validation`, `format`, `overlap`, `audit`, `edit-service`); legacy callers import the `src/lib/leaves.ts` shim. Leave edits are audited (`LeaveRequestEdit` snapshots pre/post) and `LeaveRequest.version` is an optimistic lock bumped on every update. `working-days`/`holidays` make accrual & day-counting holiday-aware (Italian holidays).
- `mail-ingest.ts` / `mail-graph.ts` / `mail-send.ts` — Microsoft Graph email-to-leaves ingest + outbound notifications. `telegram-*.ts` — bot webhook handlers/keyboards. `monthly-report-worker.ts` — scheduled presenze report. `worker-metrics.ts` + `/api/healthz` — observability.

**Data model (`prisma/schema.prisma`):** `Employee` is the hub (records, schedule, leaves, balances, api key, optional `User` account). `AttendanceRecord.type` ∈ ENTRY/EXIT/PAUSE_START/PAUSE_END/OVERTIME_START/OVERTIME_END; `.source` ∈ PARSED/MANUAL/NFC/TELEGRAM. `User.role` ∈ ADMIN/EMPLOYEE, `active` gated by admin. Several `Unrecognized*` tables hold unmatched NFC UIDs / Telegram chats / email senders for admin triage.

---

# Ruflo — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Agent Comms — Reality-Based Coordination

**Tool-availability asymmetry:** `SendMessage` works **lead↔subagent** and lead↔lead, but **NOT subagent↔subagent**. Subagents spawned via the `Agent` tool are stateless one-shot workers — they have no inbox, cannot wait for events, and `SendMessage`/`TaskUpdate` are typically not in their tool allowlists. The `hive-mind_*` MCP tools provide coordination **metadata** (registry, consensus state) but do NOT grant subagents communication channels. Patterns that assume peer messaging will silently fail — agents either abort cleanly or run open-loop with stale assumptions. (See ruvnet/ruflo#2028 for the diagnosis.)

### Canonical pattern: memory-as-bus, lead-orchestrated phases

```
Lead (the orchestrator)
  │
  ├─ spawns agent → agent reads inputs from memory keys → writes outputs to memory keys → completes
  │
  ├─ verifies outputs in memory
  │
  └─ spawns next agent with explicit input-key list in its brief
```

All inter-agent state lives in a shared memory namespace (`memory_store` / `memory_search`). Lead-to-subagent `SendMessage` is fine when needed; subagent-to-subagent `SendMessage` is not.

### Spawning rules

- **Parallelize ONLY when work is genuinely independent** (no upstream dependency between siblings).
- **Spawn dependent agents only after the lead confirms upstream outputs are in memory.** Do NOT tell a downstream agent to "WAIT for SendMessage from X" — it has no mechanism to wait; it will abort.
- **Every subagent brief MUST include a degraded-mode paragraph** at the top: *"If your expected coordination tools (SendMessage, TaskUpdate, hive-mind_*) are missing, do NOT abort. Read these specific source files directly, write outputs to these specific memory keys, and complete your phase."*
- **Name agents** — `name: "role"` makes them addressable by the lead even though they cannot address each other.
- **After spawning**: STOP, tell user what's running, wait for completion notifications. No polling.

### Spawning example (memory-as-bus)

```javascript
// Phase 1 — independent parallel work
Agent({
  prompt: "Read docs at <paths>. Write inventory JSON to memory key phase1/researcher/inventory in namespace <ns>. Degraded mode: if memory tools missing, return inventory in your final message.",
  subagent_type: "researcher", name: "researcher", run_in_background: true
})
Agent({
  prompt: "Walk the source tree. Write capability matrix to memory key phase1/coder/capability-matrix. Degraded mode: ...",
  subagent_type: "coder", name: "source-reader", run_in_background: true
})

// AFTER both Phase 1 agents complete (lead verifies via memory_search), THEN spawn Phase 2.
// Each Phase 2 agent's brief explicitly lists the Phase 1 memory keys it should read.
```

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Sequential pipeline** | Lead → A → (verify in memory) → B → (verify) → C | Phase dependencies (audit, complex refactor) |
| **Fan-out** | Lead → A, B, C (parallel) → Lead aggregates from memory | Independent parallel work (research, multi-lens critique) |
| **Lead-as-bus** | Subagents → Lead → reroute by spawning next | Workaround when supervisor↔workers coordination needed |

### Anti-patterns (will silently fail)

- "WAIT for SendMessage from X" in a subagent prompt — no mechanism to wait
- "SendMessage findings to architect" in a subagent prompt — architect can't receive
- Spawning N dependent agents in one batch expecting them to chain via messages — they won't
- Relying on `hive-mind_consensus` to gather subagent votes — subagents aren't registered hive workers

### Lead-only SendMessage (still works)

`SendMessage` is still useful for **lead → subagent** redirects and priority changes:

```javascript
// Lead → subagent: redirect or update priority mid-flight
SendMessage({ to: "developer", summary: "Prioritize auth", message: "Auth is blocking tester, do that first." })
// Lead → subagent: graceful shutdown
SendMessage({ to: "developer", message: { type: "shutdown_request" } })
```

## Swarm & Routing

### Config
- **Topology**: hierarchical-mesh (anti-drift)
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions

### 3-Tier Model Routing

| Tier | Handler | Use Cases |
|------|---------|-----------|
| 1 | Agent Booster (WASM) | Simple transforms — skip LLM, use Edit directly |
| 2 | Haiku | Simple tasks, low complexity |
| 3 | Sonnet/Opus | Architecture, security, complex reasoning |

## Memory & Learning

### Before Any Task
```bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
```

### After Success
```bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

### MCP Tools (use `ToolSearch("keyword")` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | `memory_store`, `memory_search`, `memory_search_unified` |
| **Bridge** | `memory_import_claude`, `memory_bridge_status` |
| **Swarm** | `swarm_init`, `swarm_status`, `swarm_health` |
| **Agents** | `agent_spawn`, `agent_list`, `agent_status` |
| **Hooks** | `hooks_route`, `hooks_post-task`, `hooks_worker-dispatch` |
| **Security** | `aidefence_scan`, `aidefence_is_safe`, `aidefence_has_pii` |
| **Hive-Mind** | `hive-mind_init`, `hive-mind_consensus`, `hive-mind_spawn` |

### Background Workers

| Worker | When |
|--------|------|
| `audit` | After security changes |
| `optimize` | After performance work |
| `testgaps` | After adding features |
| `map` | Every 5+ file changes |
| `document` | After API changes |

```bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
```

## Agents

**Core**: `coder`, `reviewer`, `tester`, `planner`, `researcher`
**Architecture**: `system-architect`, `backend-dev`, `mobile-dev`
**Security**: `security-architect`, `security-auditor`
**Performance**: `performance-engineer`, `perf-analyzer`
**Coordination**: `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
**GitHub**: `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

Any string works as a custom agent type.

## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing

```bash
npm run build && npm test
```

## CLI Quick Reference

```bash
npx @claude-flow/cli@latest init --wizard           # Setup
npx @claude-flow/cli@latest swarm init --v3-mode     # Start swarm
npx @claude-flow/cli@latest memory search --query "" # Vector search
npx @claude-flow/cli@latest hooks route --task ""    # Route to agent
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest security scan            # Security scan
npx @claude-flow/cli@latest performance benchmark    # Benchmarks
```

26 commands, 140+ subcommands. Use `--help` on any command for details.

## Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

**Agent tool** handles execution (agents, files, code, git). **MCP tools** handle coordination (swarm, memory, hooks). **CLI** is the same via Bash.
