# PresenzeNfcService

Servizio Windows che trasforma un lettore NFC PC/SC (testato su **bit4id miniLector AIR 3**) in un kiosk di timbratura per il backend HR `presenze-whatsapp`.

## ⚠️ Quale tessera usare

**Usa badge Mifare Classic 1K (o equivalenti)** come tessera per i dipendenti.

**NON usare** CIE 3.0, CNS recenti, carte bancarie contactless o smartphone NFC: queste tessere generano un **UID casuale ad ogni lettura** (anti-tracking ISO 14443-3, gli UID iniziano per `08`), quindi non sono adatte come badge stabile — ogni tap verrebbe interpretato come una tessera diversa.

I badge Mifare Classic 1K hanno un UID a 4 byte **fisso e immutabile**, costano pochi euro per lotti da 10-100 pezzi, e funzionano nativamente col lettore bit4id e con questo servizio senza alcuna modifica al codice. Verificato sul campo: il primo test con CIE ha mostrato 4 UID diversi su 4 tap consecutivi della stessa tessera.

## Caratteristiche

- **Single .exe** ~30 KB, **C# .NET Framework 4.8 x86** → gira su Windows 7+ con .NET 4.8 installato (il PC di produzione attuale ha 4.8, non 3.5 — 3.5 e 4.x sono due runtime distinti su Windows). Il codice non usa feature 4.x-specifiche quindi retargettare a 3.5 o 4.0 è una modifica da una sola riga nel .csproj.
- **Zero dipendenze esterne** (no NuGet, niente runtime aggiuntivo oltre a .NET 4.8 che è installabile su tutte le Windows ≥7)
- **Tutta la logica di business sta sul server**: il client legge l'UID via APDU `FF CA 00 00 00`, lo POSTa al backend, beep
- **Headless** (Windows Service in background) ma include modalità `--console` per debug
- **Feedback sonoro distinto** per ENTRY / EXIT / PAUSE / UID sconosciuto / errore — onde sintetizzate in memoria, niente file audio da distribuire
- **Auto-install** del servizio Windows con `--install`

## Compilazione

Su una macchina con Visual Studio 2022 (qualsiasi edizione) o Build Tools:

```cmd
msbuild PresenzeNfcService.sln /p:Configuration=Release /p:Platform=x86
```

L'output è in `bin\Release\PresenzeNfcService.exe`. Distribuisci insieme:
- `PresenzeNfcService.exe`
- `config.template.ini` (l'utente lo rinominerà in `config.ini`)

## Installazione sulla postazione

1. Installa il driver del lettore (per bit4id: scaricalo da bit4id.com)
2. Verifica il lettore: `PresenzeNfcService.exe --probe` (deve elencare almeno un lettore)
3. Copia `config.template.ini` → `config.ini` e compila:
   - `url` = endpoint del server HR (es. `http://hr.lan.local:3000`)
   - `api_key` = generata da **Impostazioni → Chiavi API** del backend HR
4. Da prompt **come Amministratore**:
   ```cmd
   PresenzeNfcService.exe --install
   sc start PresenzeNfcService
   ```
5. Verifica nei log: `%ProgramData%\PresenzeNfcService\logs\service-YYYYMMDD.log`

## Disinstallazione

```cmd
sc stop PresenzeNfcService
PresenzeNfcService.exe --uninstall
```

## CLI

| Comando | Effetto |
|---|---|
| `PresenzeNfcService.exe` | Avvio in modalità servizio (chiamato dal Service Control Manager) |
| `PresenzeNfcService.exe --console` | Esecuzione interattiva con log su stdout (debug) |
| `PresenzeNfcService.exe --install` | Registra il servizio Windows (richiede admin) |
| `PresenzeNfcService.exe --uninstall` | Rimuove il servizio (richiede admin) |
| `PresenzeNfcService.exe --probe` | Elenca i lettori PC/SC trovati e termina |
| `PresenzeNfcService.exe --version` | Versione |

## Architettura

```
[CIE / Mifare] →tap→ [bit4id miniLector AIR 3]
                              │  USB CCID
                              ▼
                    [WinSCard.dll  PC/SC]
                              │
                              ▼
                    PcscReader  (P/Invoke)
                              │  uid hex
                              ▼
                    NfcService.HandleUid
                       ┌──────┴──────┐
                       ▼             ▼
                    HrClient       Beeper
                  (HttpWebRequest) (PlaySound winmm)
                       │
                       ▼
              POST /api/kiosk/punch
              Authorization: Bearer <ApiKey>
              { "uid": "ABCD1234" }
                       │
                       ▼
              Backend HR Next.js (LAN)
              - Resolve UID → Employee
              - classifier (server-side)
              - INSERT AttendanceRecord
              - syncAnomalies
                       │
                       ▼
              { status, action, employeeName, time }
                       │
                       ▼
                    Beeper.Play(action)
```

## Mappatura risposta → suono

| HTTP | `status` | `action` | Suono |
|---|---|---|---|
| 201 | `ok` | `ENTRY` | 2 toni ascendenti (do→mi) |
| 201 | `ok` | `EXIT` | 2 toni discendenti (mi→do) |
| 201 | `ok` | `PAUSE_START` o `PAUSE_END` | 1 tono medio |
| 404 | `unknown_uid` | — | 3 beep medi |
| 429 | `too_soon` | — | buzz basso (errore) |
| 409 | `duplicate` | — | buzz basso |
| 4xx/5xx altro | — | — | buzz basso |
| 0 (rete giù) | — | — | buzz basso |

I suoni vengono **sintetizzati in memoria allo startup** come PCM 16-bit 22050 Hz mono e riprodotti via `winmm!PlaySound` con flag `SND_MEMORY|SND_ASYNC`. Niente file su disco.

## Note operative

- **Account servizio**: `LocalSystem` (default). Necessario per accedere a Session 0 audio e al lettore PC/SC.
- **Suono da Session 0**: su Windows 7+ la riproduzione audio dal Session 0 funziona se la scheda audio è attiva e gli altoparlanti accesi. Se non senti niente, controlla il volume di sistema e che ci sia una **scheda audio reale** (non solo HDMI scollegato).
- **Il PC speaker (`Console.Beep`)**: usato come fallback ma sui PC moderni in genere non emette nulla. Affidati alle casse.
- **Niente persistenza locale**: il client è stateless. Se il server è giù, il tap viene perso (è un kiosk in LAN col server, non smart-working). Per buffering offline servirebbe SQLite locale — fuori scope.
- **Debounce**: doppio. Client (`debounce_ms` in config) + server (10 secondi fissi). Il client evita anche i pochi millisecondi di rumore di lettura del lettore stesso quando una tessera resta poggiata.

## Troubleshooting

**`SCardEstablishContext failed`** → il servizio "Smart Card" di Windows non gira. Avvialo: `sc start SCardSvr`.

**`Nessun lettore PC/SC disponibile`** → driver bit4id non installato o lettore scollegato. Esegui `--probe` per debug.

**Servizio avviato ma non timbra** → controlla i log in `%ProgramData%\PresenzeNfcService\logs\`. I tap riusciti loggano `Tap UID=... → 201 ENTRY (Mario Rossi)`.

**Il servizio non sente l'audio** → PC senza casse / volume Session 0 a zero. Per testarlo dalla session dell'utente: ferma il servizio e lancia `PresenzeNfcService.exe --console` come utente loggato.

Vedi anche [TESTING.md](TESTING.md) per la checklist di smoke test sul PC target.
