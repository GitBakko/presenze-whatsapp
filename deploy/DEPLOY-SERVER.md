# Deploy backend HR su Windows Server 2016 + IIS

Procedura completa per pubblicare il portale HR `presenze-whatsapp` su
**Windows Server 2016** esposto via IIS a `https://hr.epartner.it` sulla
porta 443.

## Architettura

```
                 hr.epartner.it:443
                        │  HTTPS
                        ▼
                 ┌───────────────┐
                 │  IIS + ARR    │   Reverse proxy
                 │  + URL Rewrite│
                 └───────┬───────┘
                         │ HTTP localhost:3100
                         ▼
                 ┌───────────────┐
                 │ Node 20 LTS   │   Servizio Windows "PresenzeHR"
                 │ server.js     │   (NSSM, LocalSystem, autostart)
                 │ (.next/       │
                 │  standalone)  │
                 └───────┬───────┘
                         │
                         ▼
                 E:\HR\data\prod.db   (SQLite)
```

## Layout cartelle sul server

```
E:\HR\
├── app\                         <- il pacchetto Next.js standalone
│   ├── server.js
│   ├── package.json
│   ├── node_modules\
│   ├── .next\                   <- server chunks compilati
│   ├── public\                  <- asset statici + uploads\avatars
│   ├── prisma\
│   │   └── schema.prisma
│   └── .env                     <- configurazione prod (da env.production.template)
├── data\
│   └── prod.db                  <- database SQLite (FUORI da app\)
├── logs\
│   ├── stdout.log
│   └── stderr.log
└── backups\
    └── prod-YYYYMMDD-HHMMSS.db  <- backup rotativi
```

## Permessi NTFS richiesti

L'account `LocalSystem` (sotto cui gira il servizio NSSM) ha già accesso
full a tutto `E:\`, ma se preferisci un account dedicato, questi sono
i minimi:

| Percorso | Permesso richiesto |
|---|---|
| `E:\HR\app\` | `Read & Execute` (solo lettura) |
| `E:\HR\app\public\uploads\avatars\` | `Modify` (scrive avatar caricati) |
| `E:\HR\data\` | `Modify` (scrive `prod.db`) |
| `E:\HR\logs\` | `Modify` (scrive stdout/stderr del servizio) |
| `E:\HR\backups\` | `Modify` (script di backup) |

Per il servizio IIS (`IIS AppPool\presenze-hr`):

| Percorso | Permesso |
|---|---|
| `C:\inetpub\wwwroot\presenze-hr\` (solo web.config) | `Read` |

---

## Passo 1 — Prerequisiti software

Fai il login RDP al server come amministratore, poi installa in ordine:

### 1.1 Node.js 20 LTS

1. Scarica da https://nodejs.org/en/download — file **Windows Installer (.msi) 64-bit**
2. Installa in `C:\Program Files\nodejs\`
3. Verifica:
   ```powershell
   node -v     # deve stampare v20.x.x
   npm -v
   ```

### 1.2 IIS con i ruoli necessari

Server Manager → Add Roles and Features → Web Server (IIS) con:

- Common HTTP Features (tutti i default)
- **Health and Diagnostics** → tutti
- **Performance** → Static Content Compression, Dynamic Content Compression
- **Security** → Request Filtering, IP and Domain Restrictions (opzionale)
- **Management Tools** → IIS Management Console

### 1.3 URL Rewrite + ARR (Application Request Routing)

Questi sono i due moduli **essenziali** per il reverse proxy. Scaricali
dal Microsoft Web Platform Installer **o** direttamente:

- URL Rewrite 2.1:
  https://www.iis.net/downloads/microsoft/url-rewrite
- Application Request Routing 3.0:
  https://www.iis.net/downloads/microsoft/application-request-routing

Installa entrambi.

Poi **abilita la reverse proxy a livello di server**:

1. Apri **IIS Manager**
2. Click sul nodo `<NOMESERVER>` (radice, non un sito specifico)
3. Nel pannello centrale, doppio click su **Application Request Routing Cache**
4. Nella sidebar destra, **Server Proxy Settings**
5. Spunta **Enable proxy**
6. **Apply** (sidebar destra)

Se salti questo passaggio, IIS non farà il reverse proxy nemmeno se il
`web.config` ha le rewrite rule corrette.

### 1.4 NSSM (Non-Sucking Service Manager)

1. Scarica da https://nssm.cc/download (ultima stable)
2. Estrai il contenuto in `C:\Tools\nssm\`
3. Usa `C:\Tools\nssm\win64\nssm.exe` (rinomina o sposta a
   `C:\Tools\nssm\nssm.exe` per semplicita')

---

## Passo 2 — Preparazione del pacchetto Next.js

Sul **tuo PC di sviluppo** (d:\Develop\AI\Hr):

```powershell
cd d:\Develop\AI\Hr
npm run build
```

Il build produce `.next/standalone/` che contiene tutto il necessario.
**ATTENZIONE**: `next build` NON copia `public/` e `.next/static/` dentro
`standalone/` — vanno copiati a mano.

Crea un pacchetto zippato con questa struttura:

```powershell
# Crea la staging area
$stage = "$env:TEMP\presenze-hr-deploy"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

# 1. Copia standalone (server.js + node_modules minimi)
Copy-Item -Recurse .\.next\standalone\* $stage

# 2. Copia gli asset statici di Next
New-Item -ItemType Directory -Path "$stage\.next\static" | Out-Null
Copy-Item -Recurse .\.next\static\* "$stage\.next\static"

# 3. Copia la cartella public (asset statici pubblici + uploads vuoto)
Copy-Item -Recurse .\public "$stage\public"

# 4. Copia prisma/schema.prisma (il client include gia' i binary nativi
#    dentro standalone\node_modules\.prisma)
New-Item -ItemType Directory -Path "$stage\prisma" -Force | Out-Null
Copy-Item .\prisma\schema.prisma "$stage\prisma\schema.prisma"

# 5. Template .env
Copy-Item .\deploy\env.production.template "$stage\.env.template"

# 6. Zip
Compress-Archive -Path "$stage\*" -DestinationPath ".\presenze-hr-deploy.zip" -Force
Write-Host "Pacchetto pronto: $(Resolve-Path .\presenze-hr-deploy.zip)"
```

Copia il file `presenze-hr-deploy.zip` sul server (cartella di comodo,
es. `E:\HR\incoming\`).

---

## Passo 3 — Estrazione e configurazione sul server

Sul **server** (PowerShell admin):

```powershell
# 3.1 Crea la struttura
New-Item -ItemType Directory -Force -Path E:\HR\app, E:\HR\data, E:\HR\logs, E:\HR\backups | Out-Null

# 3.2 Estrai il pacchetto
Expand-Archive -Path E:\HR\incoming\presenze-hr-deploy.zip -DestinationPath E:\HR\app -Force

# 3.3 Verifica che esista server.js
Test-Path E:\HR\app\server.js      # deve essere True

# 3.4 Copia e compila l'.env
Copy-Item E:\HR\app\.env.template E:\HR\app\.env
notepad E:\HR\app\.env
```

Nel `.env` compila almeno:

- `NEXTAUTH_SECRET` — genera con:
  ```powershell
  [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  ```
- `SYSTEM_REGISTRATION_SECRET` — un qualsiasi secret (10-20 caratteri), servirà solo per creare il primo utente admin
- Gli altri valori (`DATABASE_URL`, `NEXTAUTH_URL`, `PORT`, `HOSTNAME`, `NODE_ENV`) sono già corretti di default.

---

## Passo 4 — Inizializzazione del database SQLite

```powershell
cd E:\HR\app
# Il client Prisma e' gia' dentro standalone\node_modules, ma il CLI
# "prisma" non c'e'. Lo installiamo temporaneamente global per lanciare
# db:push (crea lo schema al primo run).
npm install -g prisma@6.19.2

# Punta al DB di produzione
$env:DATABASE_URL = "file:E:/HR/data/prod.db"
prisma db push --schema=prisma\schema.prisma

# Verifica
Test-Path E:\HR\data\prod.db   # deve essere True
```

Il `db push` crea il file `prod.db` vuoto con tutte le tabelle.

---

## Passo 5 — Installazione del servizio Windows

Copia sul server lo script `deploy\install-service.ps1` (es. in `E:\HR\app\install-service.ps1`) e lancia:

```powershell
cd E:\HR\app
PowerShell -ExecutionPolicy Bypass -File .\install-service.ps1
```

Se gli script di PowerShell sono bloccati:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install-service.ps1
```

Lo script:
1. Crea il servizio `PresenzeHR` via NSSM
2. Lo configura con `LocalSystem`, auto-start, restart on crash
3. Redirige stdout/stderr in `E:\HR\logs\`
4. Avvia il servizio

**Verifica che Node risponda in locale:**

```powershell
Invoke-WebRequest http://127.0.0.1:3100/api/kiosk/health | Select-Object -ExpandProperty Content
```

Deve tornare `{"ok":true,...}`. Se no, controlla `E:\HR\logs\stderr.log`.

---

## Passo 6 — Configurazione IIS (sito + binding HTTPS)

### 6.1 Crea il sito IIS

1. IIS Manager → **Sites** → tasto destro → **Add Website**
2. Site name: `presenze-hr`
3. Physical path: `C:\inetpub\wwwroot\presenze-hr` (crea la cartella)
4. Binding:
   - Type: `https`
   - IP address: `All Unassigned` (o IP specifico)
   - Port: `443`
   - Host name: `hr.epartner.it`
   - SSL certificate: seleziona il certificato corretto (se non ne hai uno, vedi 6.2)
5. OK

### 6.2 Certificato HTTPS

**Opzione A — Hai già un certificato** (wildcard `*.epartner.it` o dedicato):
importalo nell'**IIS Manager → Server Certificates → Import** (file `.pfx`).

**Opzione B — Self-signed per test** (NON usare in produzione vera):
```powershell
New-SelfSignedCertificate -DnsName "hr.epartner.it" -CertStoreLocation cert:\LocalMachine\My
```

**Opzione C — Let's Encrypt** via win-acme:
1. Scarica https://www.win-acme.com
2. Esegui `wacs.exe`, segui il wizard, seleziona il sito `presenze-hr`
3. win-acme installa il cert nello store Windows e lo associa al binding automaticamente

### 6.3 Copia il web.config

```powershell
Copy-Item d:\Develop\AI\Hr\deploy\iis-web.config `
          C:\inetpub\wwwroot\presenze-hr\web.config
```

(Il file `iis-web.config` è nel pacchetto di deploy — se non l'hai copiato sul server, estrailo dallo zip o copialo manualmente.)

### 6.4 Riavvia il sito e verifica

```powershell
Restart-WebItem "IIS:\Sites\presenze-hr"
```

Apri dal tuo browser: **https://hr.epartner.it**. Dovresti vedere la pagina di login del portale.

Se vedi errore 502 Bad Gateway:
- Il servizio `PresenzeHR` è fermo → `Get-Service PresenzeHR`; `Start-Service PresenzeHR`
- ARR non abilitato (vedi passo 1.3)
- Firewall Windows blocca localhost (raro)

Se vedi errore 500.19 config:
- Mancano URL Rewrite o ARR → torna al passo 1.3

---

## Passo 7 — Creazione del primo utente admin

Una volta che `https://hr.epartner.it` risponde:

```powershell
$secret = "il-valore-di-SYSTEM_REGISTRATION_SECRET-dal-.env"
$body = @{
  email          = "admin@epartner.it"
  name           = "Admin"
  password       = "una-password-forte-min-8-char"
  systemPassword = $secret
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://hr.epartner.it/api/register" `
                  -Method POST `
                  -Body $body `
                  -ContentType "application/json"
```

Ora loggati sul browser con queste credenziali.

**Subito dopo**, per sicurezza, svuota `SYSTEM_REGISTRATION_SECRET` nel `.env` e riavvia il servizio:

```powershell
notepad E:\HR\app\.env           # svuota il valore di SYSTEM_REGISTRATION_SECRET
Restart-Service PresenzeHR
```

---

## Passo 8 — Setup post-deploy

### 8.1 Genera la API key per il kiosk NFC

1. Loggati sul portale
2. **Impostazioni → Chiavi API → Nuova chiave**
3. Nome: `Kiosk Postazione`
4. **Copia il valore plaintext** (mostrato una sola volta). Lo userai nel deploy del kiosk.

### 8.2 Configura uno `EmployeeSchedule` per ogni dipendente

**Impostazioni → Orari dipendenti** — imposta gli orari di Vlad e compagnia.

### 8.3 Crea almeno un dipendente di test

**Dipendenti → Nuovo dipendente**.

### 8.4 Task schedulato per backup SQLite

1. Copia `backup-db.ps1` in `E:\HR\scripts\`
2. Task Scheduler → Create Basic Task:
   - Name: `HR DB Backup`
   - Trigger: Daily, ore 02:00
   - Action: Start a program
   - Program: `powershell.exe`
   - Arguments: `-ExecutionPolicy Bypass -File E:\HR\scripts\backup-db.ps1`
   - Run as: `SYSTEM`, Run whether user is logged on or not

---

## Passo 9 — Verifica finale SSE (notifiche realtime)

Le Server-Sent Events devono passare attraverso IIS senza buffering.
Verifica così:

1. Apri `https://hr.epartner.it` in una finestra Chrome, loggati, apri DevTools → Network
2. Filtro `stream` — dovresti vedere una richiesta `/api/notifications/stream` in stato **pending** con type `eventsource`
3. Clicca sulla richiesta, tab **EventStream**: dovresti vedere un evento `init` ricevuto subito
4. In un'altra finestra, simula un punch (oppure collega il kiosk e tappa)
5. Nella tab EventStream del browser dovresti vedere apparire un evento `punch` entro 1 secondo

Se gli eventi **non appaiono entro ~30 secondi**:
- IIS sta bufferizzando: verifica che `httpProtocol/customHeaders/X-Accel-Buffering: no` sia effettivamente nel `web.config`
- ARR sta bufferizzando: controlla IIS Manager → `Application Request Routing Cache` → `Server Proxy Settings`, assicurati che **Response buffering** sia `Off`

---

## Troubleshooting

**502.3 Gateway Timeout al caricamento della pagina**
Il servizio Node è su ma la prima compilazione Next sta ancora girando. Aspetta 30-60s al primo avvio.

**`PrismaClientInitializationError: Environment variable not found: DATABASE_URL`**
Il `.env` non è letto. Verifica:
- Il file si chiama esattamente `.env` (non `.env.txt`)
- È in `E:\HR\app\` (stessa cartella di `server.js`)
- Il servizio è stato riavviato dopo la modifica (`Restart-Service PresenzeHR`)

**SQLITE_READONLY: attempt to write a readonly database**
`LocalSystem` non ha il permesso `Modify` su `E:\HR\data\`. Controlla ACL:
```powershell
Get-Acl E:\HR\data | Format-List
```

**Upload avatar fallisce**
`LocalSystem` non ha `Modify` su `E:\HR\app\public\uploads\avatars\`.

**Le notifiche realtime (campanella) non si aggiornano**
Vedi Passo 9 sopra.

**Il redeploy sovrascrive il database**
Non dovrebbe succedere se il DB è in `E:\HR\data\` (fuori da `app\`). Verifica che `DATABASE_URL` nel `.env` punti al path assoluto corretto.

---

## Procedura di update (deploy successivi)

```powershell
# Sul PC di sviluppo: build + pacchetto
cd d:\Develop\AI\Hr
npm run build
# (script di staging come al passo 2)

# Sul server
Stop-Service PresenzeHR
.\backup-db.ps1                              # backup pre-update
Expand-Archive presenze-hr-deploy.zip -DestinationPath E:\HR\app -Force
# .env e public/uploads/ NON sono nello zip, quindi restano intatti
Start-Service PresenzeHR
Invoke-WebRequest http://127.0.0.1:3100/api/kiosk/health
```

Se lo schema Prisma è cambiato tra una release e l'altra, rilancia
`prisma db push` (vedi Passo 4) prima di `Start-Service`.
