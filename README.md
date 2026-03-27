<div align="center">

# ⏱️ Presenze WhatsApp

**Trasforma le chat WhatsApp in un sistema di gestione presenze completo.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[Funzionalità](#-funzionalità) · [Quick Start](#-quick-start) · [Architettura](#-architettura) · [API](#-api) · [Contributing](#-contributing)

</div>

---

## 🎯 Il Problema

Molte PMI italiane gestiscono le presenze tramite messaggi WhatsApp di gruppo: _"Entrata 09:00"_, _"Uscita 18:30"_, _"Pausa 13:00 - 14:00"_.

**Presenze WhatsApp** analizza automaticamente l'export `.txt` di queste chat e genera:

- 📊 Dashboard con statistiche in tempo reale
- 🔍 Rilevamento automatico anomalie (uscite mancanti, sovrapposizioni)
- 📅 Calendario presenze per dipendente
- 🏖️ Gestione ferie, permessi e ROL (CCNL Commercio)
- 📤 Export Excel per consulenti del lavoro

---

## ✨ Funzionalità

### Importazione Intelligente
- Parser WhatsApp robusto: gestisce varianti orario (`12.30`, `12:30`), typo, messaggi multi-riga
- Supporto comandi naturali: `"Pausa come Mario"`, `"+30 minuti"`, `"Straordinario 18:30-20:00"`
- Import idempotente — i duplicati vengono ignorati automaticamente

### Dashboard
- Panoramica giornaliera con presenti/assenti/anomalie
- Grafici mensili (ore lavorate, straordinari, ritardi)
- Filtro per dipendente e range di date

### Gestione Dipendenti
- Profilo con nome display, avatar, alias (nomi WhatsApp multipli)
- Calendario mensile con badge Mattina/Pomeriggio
- Dettaglio giornaliero con timeline completa
- Modifica manuale degli orari di ingresso/uscita
- Storico straordinari

### Rilevamento Anomalie
| Tipo | Descrizione |
|------|-------------|
| `MISSING_EXIT` | Uscita mancante |
| `MISSING_ENTRY` | Entrata mancante |
| `MISMATCHED_PAIRS` | Entrate/uscite non corrispondenti |
| `PAUSE_NO_END` | Pausa senza fine |
| `OVERTIME_NO_END` | Straordinario senza fine |
| `TIME_OVERLAP` | Sovrapposizione orari ⚠️ |
| `TIME_BLOCK_MISMATCH` | Orario nel blocco sbagliato ⚠️ |

> Le anomalie ⚠️ sono **"possibili"** — calcolate in tempo reale e distinguibili visivamente da quelle strutturali.

### Ferie & Permessi
- Gestione completa: Ferie, ROL, Malattia, Matrimonio, Lutto, L.104, Visita medica
- Maturazione automatica secondo CCNL Commercio
- Riporto annuale e bilancio in tempo reale
- Supporto Full-Time / Part-Time proporzionato

### Orari Personalizzati
- Schedule settimanale per dipendente (blocco mattina + pomeriggio)
- Tolleranza ritardo configurabile (default: 15 min)
- Calcolo ore lavorate su base contrattuale

### Export
- Export Excel (.xlsx) con filtri data e dipendente
- Formato pronto per consulenti del lavoro

---

## 🚀 Quick Start

### Prerequisiti

- **Node.js** ≥ 20
- **npm** ≥ 10

### Installazione

```bash
# Clone
git clone https://github.com/<tuo-utente>/presenze-whatsapp.git
cd presenze-whatsapp

# Installa dipendenze
npm install

# Configura environment
cp .env.example .env
# Modifica .env con i tuoi valori (vedi sotto)

# Inizializza database
npx prisma db push
npx prisma generate

# Avvia in sviluppo
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000) e registra il primo utente admin.

### Variabili d'Ambiente

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `DATABASE_URL` | Connection string SQLite | `file:./dev.db` |
| `NEXTAUTH_SECRET` | Secret per JWT sessions | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL base dell'applicazione | `http://localhost:3000` |
| `SYSTEM_REGISTRATION_SECRET` | Secret per registrazione admin | Scegli una password sicura |

### Build di Produzione

```bash
npm run build
npm start
```

---

## 🏗️ Architettura

```
src/
├── app/
│   ├── (dashboard)/          # Pagine protette
│   │   ├── page.tsx          # Dashboard principale
│   │   ├── employees/        # Gestione dipendenti
│   │   ├── anomalies/        # Lista anomalie
│   │   ├── import/           # Import chat WhatsApp
│   │   ├── reports/          # Report e export
│   │   └── settings/         # Impostazioni (orari, nomi esclusi)
│   ├── api/                  # API Routes
│   │   ├── attendance/       # Calcolo presenze
│   │   ├── anomalies/        # Gestione anomalie
│   │   ├── employees/        # CRUD dipendenti
│   │   ├── import/upload/    # Upload e parsing chat
│   │   ├── export/           # Export Excel
│   │   ├── leaves/           # Ferie e permessi
│   │   ├── schedule/         # Orari settimanali
│   │   └── stats/            # Statistiche aggregate
│   ├── login/                # Autenticazione
│   └── register/             # Registrazione admin
├── components/               # Componenti React riusabili
├── lib/
│   ├── parser.ts             # Parser WhatsApp → record strutturati
│   ├── calculator.ts         # Calcolo ore, ritardi, anomalie
│   ├── leaves.ts             # Logica ferie/ROL/maturazione
│   ├── anomaly-sync.ts       # Sincronizzazione anomalie DB
│   ├── auth.ts               # Configurazione NextAuth
│   ├── constants.ts          # Orari di riferimento, tolleranze
│   └── db.ts                 # Client Prisma singleton
└── middleware.ts              # Protezione route autenticate
```

### Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **UI** | React 19, Tailwind CSS 4, Lucide Icons |
| **Database** | SQLite via Prisma 6 |
| **Auth** | NextAuth v5 (JWT + Credentials) |
| **Charts** | Recharts 3 |
| **Export** | SheetJS (xlsx) |
| **Design** | Material 3 Design Tokens |

---

## 📡 API

Tutte le API sono protette da autenticazione JWT (cookie-based). Le API con prefisso `api/` supportano anche autenticazione via API Key (`x-api-key` header).

### Endpoint Principali

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/attendance` | Presenze calcolate (con filtri data/dipendente) |
| `GET` | `/api/anomalies` | Lista anomalie (DB + calcolate in tempo reale) |
| `POST` | `/api/anomalies/dismiss` | Segna anomalia possibile come corretta |
| `PUT` | `/api/anomalies/:id` | Risolvi anomalia con azioni correttive |
| `GET/POST` | `/api/employees` | Lista / Crea dipendenti |
| `GET/PUT` | `/api/employees/:id` | Dettaglio / Aggiorna dipendente |
| `POST` | `/api/import/upload` | Upload e parsing chat WhatsApp (.txt) |
| `GET` | `/api/export` | Export Excel presenze |
| `GET/POST` | `/api/records` | Lista / Crea record presenze |
| `PUT/DELETE` | `/api/records/:id` | Modifica / Elimina record |
| `GET` | `/api/stats` | Statistiche aggregate |
| `GET/PUT` | `/api/schedule` | Orari settimanali dipendenti |
| `GET/POST` | `/api/leaves` | Ferie e permessi |
| `GET` | `/api/leaves/balance` | Bilancio ferie/ROL |

---

## 🔧 Script Disponibili

```bash
npm run dev          # Avvia dev server (Turbopack)
npm run build        # Build di produzione
npm start            # Avvia server produzione
npm run lint         # ESLint
npm run db:push      # Applica schema Prisma al DB
npm run db:studio    # Apri Prisma Studio (GUI database)
npm run db:generate  # Rigenera Prisma Client
```

---

## 📝 Formato Chat WhatsApp Supportato

Il parser riconosce il formato standard dell'export WhatsApp:

```
27/03/2026, 09:02 - Mario Rossi: Entrata 09:00
27/03/2026, 13:05 - Mario Rossi: Uscita 13:00
27/03/2026, 14:33 - Mario Rossi: Entrata 14:30
27/03/2026, 18:35 - Mario Rossi: Uscita 18:30
27/03/2026, 13:00 - Luigi Verdi: Pausa 13:00 - 14:00
27/03/2026, 18:30 - Luigi Verdi: +30 minuti
```

### Comandi Riconosciuti

| Comando | Esempio | Descrizione |
|---------|---------|-------------|
| Entrata/Uscita | `Entrata 09:00` | Registra ingresso/uscita |
| Pausa completa | `Pausa 13:00 - 14:00` | Blocco pausa con inizio e fine |
| Inizio/Fine pausa | `Inizio pausa 13:00` | Pausa in due messaggi |
| Straordinario | `+30 minuti` o `18:30-20:00` | Ore extra |
| Copia pausa | `Pausa come Mario` | Copia orari pausa di un collega |
| Fine | `Fine` | Chiude l'azione corrente aperta |

---

## 🤝 Contributing

I contributi sono benvenuti! Consulta [CONTRIBUTING.md](CONTRIBUTING.md) per le linee guida.

1. Forka il repository
2. Crea un branch (`git checkout -b feature/nuova-funzione`)
3. Committa le modifiche (`git commit -m 'feat: aggiungi nuova funzione'`)
4. Pusha il branch (`git push origin feature/nuova-funzione`)
5. Apri una Pull Request

---

## 📄 Licenza

Distribuito con licenza MIT. Vedi [LICENSE](LICENSE) per dettagli.

---

<div align="center">

Fatto con ❤️ per le PMI italiane

</div>
