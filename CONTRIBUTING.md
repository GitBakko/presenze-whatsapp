# Contributing a Presenze WhatsApp

Grazie per il tuo interesse nel contribuire! 🎉

## 🚀 Setup Sviluppo

```bash
git clone https://github.com/<tuo-utente>/presenze-whatsapp.git
cd presenze-whatsapp
npm install
cp .env.example .env       # configura le variabili
npx prisma db push
npm run dev
```

## 📋 Convenzioni

### Branch

| Prefisso | Uso |
|----------|-----|
| `feat/` | Nuova funzionalità |
| `fix/` | Correzione bug |
| `docs/` | Documentazione |
| `refactor/` | Refactoring senza cambio di comportamento |
| `chore/` | Manutenzione, dipendenze |

### Commit Messages

Seguiamo [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: aggiungi export PDF presenze
fix: correggi calcolo ore part-time
docs: aggiorna istruzioni installazione
refactor: estrai logica parser in modulo separato
```

### Codice

- **TypeScript strict** — nessun `any` implicito
- **Zero warning** su `npx tsc --noEmit` prima di ogni PR
- Formattazione coerente (Tailwind class order, import sorting)

## 🔄 Workflow PR

1. **Fork** e crea un branch dal `main`
2. Implementa le modifiche con commit atomici
3. Verifica localmente:
   ```bash
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
4. Apri una **Pull Request** verso `main`
5. La CI verificherà lint, typecheck e build automaticamente
6. Attendi la review — rispondi ai feedback

## 🐛 Segnalare Bug

Usa il template [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) e includi:
- Passi per riprodurre
- Comportamento atteso vs effettivo
- Screenshot se applicabile
- Versione Node.js e browser

## 💡 Proporre Funzionalità

Usa il template [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) e descrivi:
- Il problema che vuoi risolvere
- La soluzione proposta
- Alternative considerate

## 📝 Struttura del Progetto

Consulta il [README](README.md#-architettura) per la struttura completa del codice.
I file principali da conoscere:

- `src/lib/parser.ts` — Parser messaggi WhatsApp
- `src/lib/calculator.ts` — Calcolo presenze e anomalie
- `src/lib/leaves.ts` — Logica ferie/permessi
- `src/app/api/` — Tutti gli endpoint API
- `src/app/(dashboard)/` — Pagine UI

---

Grazie per contribuire! 🙏
