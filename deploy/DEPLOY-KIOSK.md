# Deploy del kiosk NFC sul PC postazione (Windows 7)

Procedura completa per installare `PresenzeNfcService` sul PC Windows 7
con il lettore **bit4id miniLector AIR 3** collegato, puntato al
backend HR `https://hr.epartner.it`.

## Prerequisiti verificati sul PC target

- [x] Windows 7 (x86 o x64, qualsiasi SKU)
- [x] .NET Framework 4.8 installato
- [x] Driver bit4id installati, lettore visibile in Device Manager
- [x] Servizio "Smart Card" Windows attivo
- [x] Connettività LAN verso `https://hr.epartner.it` (porta 443)
- [x] Accesso amministratore fisico al PC

**NB sul .NET target**: l'eseguibile è compilato per **.NET Framework 4.8**
(NON 3.5). Questo perché .NET 3.5 e 4.x su Windows sono due runtime
separati, e il PC ha solo 4.8. Il codice è C# portabile, nessuna
dipendenza 4.x-specifica.

## Cosa ti serve portare sul PC

Un solo pacchetto zip con:

```
presenze-kiosk-v1.0.zip
├── PresenzeNfcService.exe         (~30 KB, compilato Release x86 net48)
├── config.template.ini
└── README-QUICKSTART.txt          (questa guida in breve)
```

Lo puoi preparare dal PC di sviluppo con:

```powershell
cd d:\Develop\AI\Hr\tools\PresenzeNfcService
# Compila Release x86
& "C:\Program Files\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe" `
  PresenzeNfcService.sln /p:Configuration=Release /p:Platform=x86 /t:Rebuild

# Pacchetto
$stage = "$env:TEMP\presenze-kiosk-stage"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item .\bin\Release\PresenzeNfcService.exe $stage
Copy-Item .\config.template.ini $stage
Compress-Archive -Path "$stage\*" -DestinationPath .\presenze-kiosk-v1.0.zip -Force
```

Copialo sul PC (USB, rete, OneDrive, ecc.).

---

## Passo 1 — Verifica prerequisiti sul PC postazione

Apri **Prompt comandi come Amministratore** sul PC Win7:

### 1.1 .NET Framework 4.8

```cmd
reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release
```

Deve stampare un `Release` REG_DWORD **528040** o superiore (528040 = 4.8).
Se il valore è più basso o il registro non esiste, installa 4.8:

1. Scarica l'installer offline: https://dotnet.microsoft.com/en-us/download/dotnet-framework/net48
2. Esegui `ndp48-x86-x64-allos-enu.exe`
3. Riavvia se richiesto

### 1.2 Servizio Smart Card

```cmd
sc query SCardSvr
```

Deve essere `STATE: 4 RUNNING`. Se `STOPPED`:

```cmd
sc config SCardSvr start= auto
sc start SCardSvr
```

### 1.3 Driver bit4id e lettore fisico

Con il lettore collegato via USB:

```cmd
certutil -scinfo
```

Deve elencare il nome del lettore (es. `BIT4ID miniLector AIR NFC v3 0`).
Se dice "Nessun dispositivo smart card", reinstalla i driver bit4id.

---

## Passo 2 — Estrazione del pacchetto

```cmd
mkdir C:\PresenzeNfc
cd C:\PresenzeNfc
```

Estrai il contenuto di `presenze-kiosk-v1.0.zip` in `C:\PresenzeNfc`.
Deve contenere:

```
C:\PresenzeNfc\
├── PresenzeNfcService.exe
└── config.template.ini
```

---

## Passo 3 — Probe del lettore con il binario

```cmd
cd C:\PresenzeNfc
PresenzeNfcService.exe --probe
```

Output atteso:

```
Probe lettori PC/SC...
Lettori trovati (1):
  [0] BIT4ID miniLector AIR NFC v3 0
```

Se vedi "Nessun lettore PC/SC trovato":
- Controlla che il lettore sia collegato (LED acceso)
- Ricontrolla il servizio `SCardSvr`
- Prova un'altra porta USB
- Reinstalla i driver

---

## Passo 4 — Genera l'API key dal backend HR

Sul portale `https://hr.epartner.it`:

1. Loggati come admin
2. **Impostazioni → Chiavi API → Nuova chiave**
3. Nome: `Kiosk Postazione` (o qualcosa di riconoscibile)
4. Click **Crea**
5. **COPIA IL VALORE PLAINTEXT** mostrato nel box verde — viene mostrato
   una sola volta, non potrai mai più rivederlo

Esempio del valore che ti viene dato:
```
094f19ea0631b463d7e47513ac43370fe6a9030b762dd7289e51e702ccdcebe9
```

---

## Passo 5 — Configurazione del servizio

```cmd
cd C:\PresenzeNfc
copy config.template.ini config.ini
notepad config.ini
```

Compila `config.ini`:

```ini
[server]
url = https://hr.epartner.it
api_key = 094f19ea0631b463d7e47513ac43370fe6a9030b762dd7289e51e702ccdcebe9
timeout_ms = 5000

[reader]
preferred_name =
debounce_ms = 2500

[log]
path =
```

**NB sui certificati HTTPS**: il servizio accetta qualsiasi certificato,
anche self-signed. Se il portale è esposto con un certificato valido
(wildcard `*.epartner.it`) non ci sono problemi; se è self-signed,
continua a funzionare.

---

## Passo 6 — Test interattivo in modalità console

Prima di installare come servizio Windows, testa tutto in foreground:

```cmd
cd C:\PresenzeNfc
PresenzeNfcService.exe --console
```

Output atteso allo startup:

```
=== PresenzeNfcService - modalita' console ===
Premi CTRL+C per uscire.
[2026-04-07 18:30:00.000] [INFO] Servizio avviato. Server=https://hr.epartner.it Reader=(auto)
[2026-04-07 18:30:00.123] [INFO] Health OK, serverTime=2026-04-07T16:30:00.000Z
[2026-04-07 18:30:00.150] [INFO] Lettore selezionato: BIT4ID miniLector AIR NFC v3 0
```

Se vedi `Health KO: ...`:
- URL sbagliato nel `config.ini`
- Il server HR non è raggiungibile (firewall, DNS, certificato)
- Testa da cmd: `curl https://hr.epartner.it/api/kiosk/health`
  (curl è disponibile su Win7 solo se installato; in alternativa usa
  `PowerShell -Command "Invoke-WebRequest https://hr.epartner.it/api/kiosk/health"`)

### 6.1 Test tessera sconosciuta

Appoggia un badge Mifare nuovo al lettore:

```
[2026-04-07 18:31:00.000] [INFO] Tap UID=0A1B2C3D
[2026-04-07 18:31:00.089] [INFO]  404 unknown_uid err=Tessera non associata a nessun dipendente
```

Senti 3 beep medi dalle casse del PC.

### 6.2 Associa il badge a un dipendente

Sul portale: **Impostazioni → Postazione NFC**. Vedrai comparire
l'UID `0A1B2C3D` nella tabella "Tessere non riconosciute". Associalo a
un dipendente con il pulsante **Associa**.

### 6.3 Test tessera riconosciuta

Riappoggia lo stesso badge:

```
[2026-04-07 18:31:30.000] [INFO] Tap UID=0A1B2C3D
[2026-04-07 18:31:30.102] [INFO]  201 ENTRY (Mario Rossi)
```

Dovresti sentire il suono "do-mi" ascendente e vedere nel portale (con
admin loggato) la notifica "MARIO ROSSI è entrato".

Premi CTRL+C per fermare il test.

---

## Passo 7 — Installazione come servizio Windows

Da prompt **Amministratore**:

```cmd
cd C:\PresenzeNfc
PresenzeNfcService.exe --install
sc start PresenzeNfcService
```

Verifica che sia RUNNING:

```cmd
sc query PresenzeNfcService
```

Deve stampare `STATE: 4 RUNNING`.

I log del servizio vanno in:
```
C:\ProgramData\PresenzeNfcService\logs\service-YYYYMMDD.log
```

Controlla che si avvii correttamente:

```cmd
type "C:\ProgramData\PresenzeNfcService\logs\service-*.log"
```

Deve contenere le stesse righe di avvio (`Servizio avviato`, `Health OK`, `Lettore selezionato`).

---

## Passo 8 — Verifica persistenza dopo riavvio

1. Riavvia il PC
2. Loggati come utente normale (non admin)
3. Controlla che il servizio sia già RUNNING:
   ```cmd
   sc query PresenzeNfcService
   ```
4. Appoggia un badge noto
5. Controlla nel portale HR che sia arrivata la timbratura

---

## Passo 9 — Verifica audio (punto critico)

Il beep di feedback viene riprodotto via `winmm.PlaySound` dal processo
servizio che gira nella **Session 0** di Windows. Su Windows 7 la
Session 0 può avere problemi ad accedere alla scheda audio.

**Test**: fai un tap. Senti il beep dalle casse del PC?

- **Sì** → tutto OK, installa davvero
- **No** → il servizio in Session 0 non riesce ad emettere audio.
  Fallback consigliato: gira in **modalità console** con una scorciatoia
  in autostart utente anziché come servizio. Vedi sezione "Fallback audio".

### Fallback audio: autostart utente invece che servizio

1. Disinstalla il servizio:
   ```cmd
   sc stop PresenzeNfcService
   PresenzeNfcService.exe --uninstall
   ```
2. Crea una scorciatoia:
   - Start → Tutti i programmi → Esecuzione automatica (tasto dx → Apri)
   - Nella cartella Esecuzione automatica: tasto dx → Nuovo → Collegamento
   - Destinazione: `C:\PresenzeNfc\PresenzeNfcService.exe --console`
   - Nome: `Presenze NFC`
3. Nella finestra Proprietà della scorciatoia → **Esegui: Minimizzata**
4. Riavvia il PC e fai login come l'utente che sta alla postazione

In questa modalità l'exe gira dentro la sessione dell'utente loggato, ha
pieno accesso all'audio, e al logout dell'utente si chiude (ma la
postazione kiosk di solito non fa logout mai).

---

## Passo 10 — Tuning finale

### Auto-login utente postazione

Se la postazione è un kiosk fisso, configura l'auto-login Windows così
dopo un eventuale riavvio riparte tutto senza intervento:

```cmd
control userpasswords2
```

Deseleziona "Per utilizzare questo computer è necessario che l'utente
immetta il nome utente e la password". Inserisci le credenziali.

### Disabilita risparmio energetico USB

Device Manager → USB Root Hub → Power Management → deseleziona
"Allow the computer to turn off this device to save power". Altrimenti
dopo periodi di inattività il lettore USB potrebbe disconnettersi.

### Disabilita standby del PC

Control Panel → Power Options → High Performance → Never sleep / Never
turn off display.

---

## Troubleshooting

**`Nessun lettore PC/SC disponibile, retry tra 3s`**
Il servizio non trova il lettore. Esegui `sc start SCardSvr`, controlla
Device Manager, reinstalla driver bit4id.

**`Health KO: Unable to connect to the remote server`**
Il PC non riesce a raggiungere `https://hr.epartner.it`. Testa DNS,
firewall, connettività LAN. Prova con IP diretto se DNS fallisce.

**`Health KO: The underlying connection was closed: Could not establish trust relationship for the SSL/TLS secure channel`**
Su alcune configurazioni .NET 4.8 accetta TLS 1.2 di default, ma se il
server HR espone protocolli piu' nuovi (TLS 1.3) potrebbe esserci
friction. Il codice del servizio esplicitamente accetta qualsiasi
certificato, quindi questo non dovrebbe succedere. Se succede, forza
TLS 1.2 con una registry key su HKLM\SOFTWARE\Microsoft\.NETFramework\v4.0.30319:
aggiungi `SchUseStrongCrypto` = DWORD 1.

**`Tap OK ma i beep non si sentono`**
Vedi Passo 9.

**`404 unknown_uid` anche dopo l'associazione**
Il badge ha UID random (CIE 3.0, EMV, smartphone HCE). Usa un badge
Mifare Classic 1K dedicato.

**Il servizio si riavvia di continuo (loop crash)**
Apri `C:\ProgramData\PresenzeNfcService\logs\service-*.log`, guarda
l'errore. Probabilmente `config.ini` malformato o path sbagliato.

---

## Disinstallazione completa

```cmd
sc stop PresenzeNfcService
PresenzeNfcService.exe --uninstall
rmdir /S /Q C:\PresenzeNfc
rmdir /S /Q C:\ProgramData\PresenzeNfcService
```

Se hai usato la modalità fallback (autostart utente), elimina anche la
scorciatoia dalla cartella Esecuzione automatica.
