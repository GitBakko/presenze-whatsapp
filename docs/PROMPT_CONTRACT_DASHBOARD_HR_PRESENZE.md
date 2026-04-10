# PROMPT CONTRACT — Dashboard HR Presenze WhatsApp
## Sprint: Dashboard Ristrutturazione (v2.0)
**Progetto:** `presenze-whatsapp` · Next.js 16 / React 19 / Tailwind CSS 4  
**Repository:** https://github.com/GitBakko/presenze-whatsapp  
**Data:** Aprile 2026  
**Versione contratto:** 1.0

---

## 1. OBIETTIVO

Ristrutturare completamente la dashboard principale (`src/app/(dashboard)/page.tsx`) per renderla una **HR Command Center** professionale, con KPI significativi, visualizzazioni dati chiare e navigazione contestuale verso le sezioni dettaglio. La dashboard deve essere il punto di ingresso operativo quotidiano per il responsabile HR/gestione presenze.

**Outcome atteso:** Un HR manager apre la dashboard la mattina e in < 10 secondi sa: chi è presente, chi è assente, se ci sono anomalie critiche, e come sta andando il mese.

---

## 2. CONTESTO TECNICO

### Stack esistente
| Layer | Tecnologia |
|---|---|
| Framework | Next.js 16, App Router, Turbopack |
| UI | React 19, Tailwind CSS 4, Lucide Icons |
| Database | SQLite via Prisma 6 |
| Auth | NextAuth v5 (JWT + cookie) |
| Charts | Recharts 3 (già installato) |
| Export | SheetJS |

### API esistenti rilevanti
| Endpoint | Dati disponibili |
|---|---|
| `GET /api/stats` | Statistiche aggregate (da estendere) |
| `GET /api/attendance` | Presenze calcolate con filtri data/dipendente |
| `GET /api/anomalies` | Lista anomalie DB + calcolate in RT |
| `GET /api/leaves/balance` | Saldo ferie/ROL per dipendente |
| `GET /api/employees` | Lista dipendenti con profili |

### Struttura file rilevante
```
src/
├── app/(dashboard)/
│   ├── page.tsx              ← FILE PRINCIPALE DA RISCRIVERE
│   └── ...
├── components/               ← Componenti riusabili esistenti
├── lib/
│   ├── calculator.ts         ← Logica calcolo ore/anomalie
│   ├── leaves.ts             ← Logica ferie/ROL
│   └── db.ts                 ← Prisma client
```

---

## 3. ARCHITETTURA DELLA NUOVA DASHBOARD

### 3.1 Layout generale
La dashboard si articola in **5 sezioni verticali** nell'ordine seguente:

```
┌─────────────────────────────────────────────────────┐
│  TOPBAR: titolo + data corrente + filtro periodo    │
├─────────────────────────────────────────────────────┤
│  SEZIONE A: Riepilogo Oggi (3 stat card grandi)     │
├─────────────────────────────────────────────────────┤
│  SEZIONE B: KPI Mensili (8 metric card — 4 col)    │
├─────────────────────────────────────────────────────┤
│  SEZIONE C: Grafici (2 col — ore lavorate + assenze)│
├─────────────────────────────────────────────────────┤
│  SEZIONE D: Dipendenti oggi + Anomalie recenti      │
├─────────────────────────────────────────────────────┤
│  SEZIONE E: Saldi ferie & ROL (progress bar table)  │
└─────────────────────────────────────────────────────┘
```

### 3.2 Filtro periodo
Il filtro `Oggi | Mese | Trimestre` nella topbar deve essere uno **state React locale** (`useState`) che condiziona i dati mostrati nelle sezioni B, C, E. La sezione A è sempre relativa a oggi.

---

## 4. SPECIFICHE FUNZIONALI PER SEZIONE

### SEZIONE A — Riepilogo Oggi
3 stat card in grid a 3 colonne, sempre relative alla data corrente.

| Card | Dato | Colore |
|---|---|---|
| Presenti | Count dipendenti con entrata oggi e nessuna anomalia MISSING_EXIT | Verde (`text-green-700`) |
| Assenti | Count dipendenti senza timbratura oggi (esclusi ferie/malattia pianificate) | Rosso |
| Anomalie aperte | Count anomalie non risolte di oggi | Ambra |

**Fonte dati:** `GET /api/attendance?date=TODAY` + `GET /api/anomalies?date=TODAY&resolved=false`

---

### SEZIONE B — KPI Mensili (8 card)
Grid 4 colonne (2 righe × 4). Ogni card mostra:
- Label (12px, muted)
- Valore principale (24px, medium)
- Delta vs mese precedente (11px, con icona ▲/▼ e colore semantico)
- Barra di contesto (3px, bottom-left, colore proporzionale al valore)

**I 8 KPI da implementare:**

| # | KPI | Formula | Colore barra | Delta: positivo se |
|---|---|---|---|---|
| 1 | Tasso presenza | `(giorni_presenza / (dipendenti × giorni_lavorabili)) × 100` | Verde | ▲ |
| 2 | Tasso puntualità | `(timbrature_puntuali / timbrature_totali) × 100` | Blu | ▲ |
| 3 | Ritardo medio (min) | `media(minuti_ritardo)` solo per le timbrature in ritardo | Blu | ▼ (meno è meglio) |
| 4 | Tasso assenteismo | `(giorni_assenza / (dipendenti × giorni_lavorabili)) × 100` | Rosso | ▼ |
| 5 | Ore straordinario totali | `sum(ore_straordinario)` del periodo | Ambra | neutro |
| 6 | Ore lavorate medie/dip | `sum(ore_lavorate) / count(dipendenti)` | Grigio | ▲ |
| 7 | Giorni malattia | `count(leaves dove tipo = MALATTIA)` del periodo | Rosso | ▼ |
| 8 | % Anomalie risolte | `(anomalie_risolte / anomalie_totali) × 100` | Verde | ▲ |

**Fonte dati:** Nuovo endpoint `GET /api/stats/dashboard?period=month|quarter` (da creare — vedi §6).

---

### SEZIONE C — Grafici (2 colonne, ratio 2:1)

#### Grafico sinistra: "Ore lavorate vs contratto — ultimi 8 mesi"
- **Tipo:** Bar chart grouped (Recharts `<BarChart>`)
- **Serie 1:** Ore contratto (grigio, `#B4B2A9`)
- **Serie 2:** Ore lavorate (blu, `#378ADD`)
- **Asse X:** mesi abbreviati (Set, Ott, Nov, Dic, Gen, Feb, Mar, Apr)
- **Tooltip:** mostra entrambi i valori + delta
- **Fonte:** `GET /api/stats/dashboard?chart=ore_mensili&months=8`

#### Grafico destra: "Assenze per tipologia"
- **Tipo:** Doughnut chart (Recharts `<PieChart>` con `innerRadius`)
- **Categorie e colori:**
  - Ferie: `#378ADD`
  - Malattia: `#E24B4A`
  - ROL: `#1D9E75`
  - Permessi: `#EF9F27`
  - Altro (L.104, Matrimonio, Lutto): `#B4B2A9`
- **Centro donut:** mostra totale giorni assenza del periodo
- **Legenda:** sotto il grafico, inline
- **Fonte:** `GET /api/stats/dashboard?chart=assenze_tipologia&period=month`

---

### SEZIONE D — 2 colonne (Dipendenti oggi | Anomalie recenti)

#### Col sinistra: Lista dipendenti — stato oggi
Per ogni dipendente (max 8, poi link "Vedi tutti"):
- Dot colorato: verde=presente, ambra=in ritardo, rosso=assente/malattia, grigio=ferie
- Avatar iniziali (colori per dipendente, deterministici da hash del nome)
- Nome completo
- Orario entrata (o label "Malattia" / "Ferie")
- Se ritardo > 15 min: icona ⚠ e orario in ambra

**Link "Dettaglio" → `/employees`**

#### Col destra: Anomalie recenti
Ultime 4 anomalie non risolte, ordinate per gravità poi per data:
- Badge tipo (`MISSING_EXIT`, `PAUSE_NO_END`, ecc.) con colore semantico:
  - `MISSING_EXIT` / `MISSING_ENTRY` → rosso (strutturali)
  - `PAUSE_NO_END` / `OVERTIME_NO_END` → ambra
  - `TIME_OVERLAP` / `TIME_BLOCK_MISMATCH` → blu (possibili)
- Nome dipendente (bold)
- Descrizione breve + data relativa ("ieri", "oggi", "3 apr")

**Link "Tutte le anomalie" → `/anomalies`**

---

### SEZIONE E — Saldi ferie & ROL
Tabella a righe per tutti i dipendenti attivi:
- Nome dipendente
- Progress bar ferie: `giorni_usati / giorni_spettanti`, colore:
  - < 60%: blu
  - 60–85%: ambra
  - > 85%: rosso (alert — poche ferie residue)
- Testo `XX/25 gg` (o proporzionale per part-time)
- Colonna separata per saldo ROL residuo (ore)

**Soglia alert:** se ferie residue < 5 giorni E siamo in H2 dell'anno → badge "⚠ Scadenza" rosso

**Link "Dettaglio bilancio" → `/reports`**

---

## 5. NUOVO COMPONENTI REACT DA CREARE

Creare nella cartella `src/components/dashboard/`:

| File | Descrizione |
|---|---|
| `StatCard.tsx` | Card KPI riutilizzabile (label, valore, delta, barra) |
| `TodayOverview.tsx` | 3 card grandi riepilogo oggi |
| `KpiGrid.tsx` | Grid 8 KPI — usa `StatCard` |
| `OreChart.tsx` | Recharts BarChart ore lavorate vs contratto |
| `AssenzeChart.tsx` | Recharts PieChart/Doughnut assenze per tipo |
| `EmployeeStatusList.tsx` | Lista dipendenti con stato oggi |
| `AnomalyList.tsx` | Lista anomalie recenti con badge |
| `LeaveBalanceTable.tsx` | Tabella saldi ferie con progress bar |
| `DashboardPeriodFilter.tsx` | Filtro Oggi/Mese/Trimestre (pill buttons) |

**Convenzioni:**
- Tutti i componenti sono `"use client"` se contengono interattività
- Usare `useSWR` (già disponibile in Next.js via fetch) o `fetch` con `cache: 'no-store'` per i dati real-time
- Props tipizzate con TypeScript interfaces in `src/types/dashboard.ts`

---

## 6. NUOVO ENDPOINT API DA CREARE

### `GET /api/stats/dashboard`

**Query params:**
```
period: 'today' | 'month' | 'quarter'   (default: 'month')
chart:  'ore_mensili' | 'assenze_tipologia' | undefined
months: number  (default: 8, solo per chart=ore_mensili)
```

**Response shape:**
```typescript
interface DashboardStatsResponse {
  period: string;
  generatedAt: string; // ISO timestamp

  // Sezione A
  today: {
    presenti: number;
    assenti: number;
    ferie: number;
    malattia: number;
    anomalieAperte: number;
  };

  // Sezione B — KPI
  kpi: {
    tassoPresenza: { value: number; delta: number };          // %
    tassoPuntualita: { value: number; delta: number };        // %
    ritardoMedioMin: { value: number; delta: number };        // minuti
    tassoAssenteismo: { value: number; delta: number };       // %
    oreStraordTotali: { value: number; delta: number };       // ore
    oreLavorateMediaDip: { value: number; delta: number };    // ore
    giorniMalattia: { value: number; delta: number };         // giorni
    percAnomalieRisolte: { value: number; delta: number };    // %
  };

  // Sezione C — Grafici
  charts?: {
    oreMensili?: Array<{
      mese: string;       // 'Set', 'Ott', etc.
      contratto: number;
      lavorate: number;
    }>;
    assenzeTipologia?: Array<{
      tipo: string;       // 'Ferie', 'Malattia', etc.
      giorni: number;
      colore: string;
    }>;
  };
}
```

**File da creare:** `src/app/api/stats/dashboard/route.ts`

**Logica:**
1. Calcola `period` da query param (today=giorno corrente, month=mese corrente, quarter=ultimi 3 mesi)
2. Per i delta: esegui la stessa query sul periodo precedente equivalente e calcola la differenza
3. Per `oggi.presenti`: conta dipendenti con almeno un record `ENTRY` oggi e nessuna anomalia `MISSING_EXIT` aperta
4. Riutilizza `lib/calculator.ts` e `lib/leaves.ts` dove possibile — non duplicare logica

---

## 7. MODIFICHE A ENDPOINT ESISTENTI

### `GET /api/attendance`
Aggiungere query param `?includeLeaveInfo=true` che arricchisce ogni record con le info ferie/malattia del giorno per quel dipendente. Necessario per la sezione D.

### `GET /api/anomalies`
Aggiungere query param `?limit=N&resolved=false&sort=severity` per il widget anomalie recenti. La severity è: MISSING_EXIT/MISSING_ENTRY = 2, PAUSE_NO_END/OVERTIME_NO_END = 1, possibili = 0.

---

## 8. DESIGN SYSTEM

Seguire il Material 3 Design Token system già configurato nel progetto. **Non introdurre nuove dipendenze CSS.**

### Palette semantica da rispettare
| Significato | Classe Tailwind | Hex |
|---|---|---|
| Presenza / Positivo | `text-green-700 bg-green-50` | `#3B6D11 / #EAF3DE` |
| Puntualità / Info | `text-blue-700 bg-blue-50` | `#185FA5 / #E6F1FB` |
| Ritardo / Warning | `text-amber-700 bg-amber-50` | `#854F0B / #FAEEDA` |
| Assenza / Errore | `text-red-700 bg-red-50` | `#A32D2D / #FCEBEB` |
| Neutro / Grigio | `text-gray-500 bg-gray-50` | `#5F5E5A / #F1EFE8` |

### Regole layout
- Card radius: `rounded-xl` (12px)
- Card border: `border border-gray-200/60`
- Card padding: `p-5`
- Grid gap: `gap-3` per KPI, `gap-4` per card grandi
- Section spacing: `mb-6` tra sezioni
- Responsive: mobile-first, `grid-cols-2 sm:grid-cols-4` per KPI, `grid-cols-1 lg:grid-cols-2` per sezione D

---

## 9. ORDINE DI IMPLEMENTAZIONE (sprint suggerito)

### Step 1 — Fondamenta dati
1. Creare `src/types/dashboard.ts` con tutte le interfacce TypeScript
2. Creare `src/app/api/stats/dashboard/route.ts` con logica completa
3. Testare endpoint via curl/browser: `GET /api/stats/dashboard?period=month`
4. Testare endpoint con `period=quarter` e verificare delta corretti

### Step 2 — Componenti atomici
5. Implementare `StatCard.tsx` (label, valore, delta, barra progress)
6. Implementare `DashboardPeriodFilter.tsx` (pill buttons con state)
7. Testare StatCard con dati mock

### Step 3 — Sezioni A e B
8. Implementare `TodayOverview.tsx`
9. Implementare `KpiGrid.tsx` che usa StatCard × 8
10. Integrare in `page.tsx` con fetch all'API reale
11. Verificare responsive su mobile

### Step 4 — Grafici
12. Implementare `OreChart.tsx` con Recharts BarChart
13. Implementare `AssenzeChart.tsx` con Recharts PieChart
14. Testare dati reali vs dati mock

### Step 5 — Sezioni D ed E
15. Implementare `EmployeeStatusList.tsx`
16. Implementare `AnomalyList.tsx` con badge colorati
17. Implementare `LeaveBalanceTable.tsx` con progress bar e alert soglia
18. Integrare tutto in `page.tsx`

### Step 6 — Rifinitura
19. Aggiungere loading skeleton per ogni sezione (Tailwind `animate-pulse`)
20. Aggiungere gestione errori per ogni fetch (componente `ErrorBanner`)
21. Verificare accessibilità: aria-label sui grafici, contrasto colori
22. Test responsività completa (mobile 375px, tablet 768px, desktop 1280px)

---

## 10. CRITERI DI ACCETTAZIONE

- [ ] Dashboard carica in < 2s a cold start su rete locale
- [ ] Tutti gli 8 KPI mostrano valori reali calcolati dal DB
- [ ] I delta vs periodo precedente sono corretti e hanno il colore giusto (verde se miglioramento, rosso se peggioramento — rispettando la direzione per KPI: assenteismo e ritardo = verde se scende)
- [ ] Il filtro Oggi/Mese/Trimestre aggiorna tutti i widget senza reload pagina
- [ ] La lista dipendenti riflette lo stato reale di oggi (non dati statici)
- [ ] Le anomalie mostrano solo quelle non risolte, ordinate per gravità
- [ ] La progress bar ferie diventa rossa per chi ha > 85% ferie consumate
- [ ] Su mobile (375px) tutto è leggibile e navigabile senza scroll orizzontale
- [ ] Nessun componente `any` TypeScript — tutto tipizzato
- [ ] I grafici Recharts sono responsive (containerWidth prop o `<ResponsiveContainer>`)

---

## 11. NOTE E VINCOLI

- **Non rimuovere** nessuna funzionalità esistente nelle altre pagine durante questa sprint
- **Non modificare** lo schema Prisma in questa sprint — solo lettura dati esistenti
- Se un dato non è disponibile nel DB (es. primo avvio senza import), mostrare `—` o `N/A` senza errori
- I grafici devono avere fallback testuale per screen reader (`aria-label` su `<ResponsiveContainer>`)
- Il colore degli avatar dipendente deve essere deterministico: usare `hashCode(nome) % N` su un array di colori predefiniti, così lo stesso dipendente ha sempre lo stesso colore
- La dashboard NON deve fare polling automatico — è sufficiente un refresh manuale (pulsante opzionale in topbar)

---

*Fine Prompt Contract — Dashboard HR Presenze WhatsApp v1.0*
