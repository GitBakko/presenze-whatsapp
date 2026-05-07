# ─────────────────────────────────────────────────────────────────────
# Pubblica un nuovo build di Presenze HR sul server IIS/NSSM.
#
# Eseguire DAL SERVER (RDP) come amministratore, dopo aver caricato
# il file presenze-hr-deploy.zip in una cartella di staging.
#
# Cosa fa:
#   1. Verifica prerequisiti (NSSM, zip, percorsi)
#   2. Ferma il servizio PresenzeHR
#   3. Sposta la cartella app corrente in un backup datato
#   4. Estrae il nuovo zip in E:\www\hr
#   5. Ripristina da backup: .env + public\uploads (avatar runtime)
#   6. Avvia il servizio
#   7. Verifica health endpoint http://127.0.0.1:3100/api/kiosk/health
#   8. Tiene solo gli ultimi -KeepBackups backup (default 3), rimuove gli altri
#
# Il database (E:\HR\data\prod.db) NON viene toccato: è fuori dalla app dir.
#
# Esempi:
#   .\publish-server.ps1 -ZipPath 'E:\deploy\presenze-hr-deploy.zip'
#   .\publish-server.ps1 -ZipPath '.\presenze-hr-deploy.zip' -ServiceName 'PresenzeHR'
# ─────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath,

  [string]$AppDir       = 'E:\www\hr',
  [string]$ServiceName  = 'PresenzeHR',
  [string]$Nssm         = 'C:\ProgramData\chocolatey\bin\nssm.exe',
  [string]$HealthUrl    = 'http://127.0.0.1:3100/api/kiosk/health',
  [int]$KeepBackups     = 3,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    $msg" -ForegroundColor Green }
function Write-WarnStep($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ─── 1. Preconditions ────────────────────────────────────────────────
Write-Step 'Verifica prerequisiti'

if (-not (Test-Path $ZipPath))  { throw "Zip non trovato: $ZipPath" }
if (-not (Test-Path $Nssm))     { throw "NSSM non trovato: $Nssm" }
if (-not (Test-Path $AppDir))   { throw "App dir non trovata: $AppDir (prima installazione? Esegui install-service.ps1)" }

$ZipPath = (Resolve-Path $ZipPath).Path
$AppDir  = (Resolve-Path $AppDir).Path
$parent  = Split-Path -Parent $AppDir
$appName = Split-Path -Leaf   $AppDir

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { throw "Servizio '$ServiceName' non esiste. Esegui prima install-service.ps1." }

# Sanity NSSM: AppDirectory deve esistere E coincidere con $AppDir. Se
# il servizio è configurato su un path diverso da quello che stiamo per
# ri-deployare, fermiamoci prima di fare danni (rename + extract).
$nssmAppDir = (& $Nssm get $ServiceName AppDirectory).Trim()
if (-not $nssmAppDir) { throw "NSSM AppDirectory vuota per '$ServiceName'. Configurazione incompleta." }
if (-not (Test-Path $nssmAppDir)) {
  throw "NSSM AppDirectory '$nssmAppDir' NON esiste sul filesystem. Fixa con: & '$Nssm' set $ServiceName AppDirectory '$AppDir'"
}
$nssmAppDirResolved = (Resolve-Path $nssmAppDir).Path
if ($nssmAppDirResolved -ne $AppDir) {
  throw "Mismatch: NSSM AppDirectory='$nssmAppDirResolved' ≠ -AppDir='$AppDir'. Passa -AppDir '$nssmAppDirResolved' o riallinea NSSM con: & '$Nssm' set $ServiceName AppDirectory '$AppDir'"
}
Write-Ok "NSSM AppDirectory allineato: $AppDir"

# Verifica che lo zip abbia i contenuti attesi (niente wrapper folder).
# Accetta entry con separatore '/' o '\' (Compress-Archive usa '\').
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $norm = { param($s) $s -replace '\\', '/' }
  $hasServerJs = $zipCheck.Entries | Where-Object { (& $norm $_.FullName) -eq 'server.js' } | Select-Object -First 1
  $hasBuildId  = $zipCheck.Entries | Where-Object { (& $norm $_.FullName) -eq '.next/BUILD_ID' } | Select-Object -First 1
  if (-not $hasServerJs) { throw "Zip non valido: manca server.js alla root" }
  if (-not $hasBuildId)  { throw "Zip non valido: manca .next/BUILD_ID (build incompleto?)" }
  $reader = New-Object System.IO.StreamReader($hasBuildId.Open())
  $newBuildId = $reader.ReadToEnd().Trim()
  $reader.Close()
} finally {
  $zipCheck.Dispose()
}
Write-Ok "Zip OK (BUILD_ID=$newBuildId)"

$currentBuildId = $null
if (Test-Path "$AppDir\.next\BUILD_ID") {
  $currentBuildId = (Get-Content "$AppDir\.next\BUILD_ID" -Raw).Trim()
  Write-Ok "BUILD_ID corrente: $currentBuildId"
}

# ─── 2. Stop service ─────────────────────────────────────────────────
Write-Step "Stop servizio $ServiceName"
& $Nssm stop $ServiceName confirm | Out-Null
Start-Sleep -Seconds 2
$status = (& $Nssm status $ServiceName).Trim()
if ($status -ne 'SERVICE_STOPPED') {
  throw "Il servizio non si è fermato (stato: $status). Abort."
}
Write-Ok 'Servizio fermato'

# ─── 3. Backup della cartella corrente ───────────────────────────────
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $parent "$appName.bak-$timestamp"

Write-Step "Backup corrente → $backupDir"
Move-Item -LiteralPath $AppDir -Destination $backupDir
Write-Ok 'Backup creato'

# ─── 4. Extract new zip ──────────────────────────────────────────────
Write-Step "Estrazione zip in $AppDir"
New-Item -ItemType Directory -Path $AppDir | Out-Null
Expand-Archive -LiteralPath $ZipPath -DestinationPath $AppDir -Force
Write-Ok 'Estrazione completata'

# Verifica post-estrazione
if (-not (Test-Path "$AppDir\server.js"))       { throw 'server.js mancante dopo estrazione' }
if (-not (Test-Path "$AppDir\.next\BUILD_ID"))  { throw '.next\BUILD_ID mancante dopo estrazione' }
$extractedBuildId = (Get-Content "$AppDir\.next\BUILD_ID" -Raw).Trim()
if ($extractedBuildId -ne $newBuildId) {
  throw "BUILD_ID estratto ($extractedBuildId) ≠ atteso ($newBuildId)"
}
Write-Ok "BUILD_ID estratto verificato: $extractedBuildId"

# ─── 5. Restore preserved files ──────────────────────────────────────
Write-Step 'Ripristino file persistenti dal backup'

# .env è l'unica configurazione che NON sta nel repo
$envSrc = Join-Path $backupDir '.env'
$envDst = Join-Path $AppDir   '.env'
if (Test-Path $envSrc) {
  Copy-Item -LiteralPath $envSrc -Destination $envDst -Force
  Write-Ok '.env ripristinato'
} else {
  Write-WarnStep '.env non trovato nel backup — il servizio potrebbe non partire. Creane uno da env.production.template.'
}

# Avatar caricati a runtime (non presenti nel repo / zip)
$uploadsSrc = Join-Path $backupDir 'public\uploads'
$uploadsDst = Join-Path $AppDir   'public\uploads'
if (Test-Path $uploadsSrc) {
  if (Test-Path $uploadsDst) { Remove-Item -LiteralPath $uploadsDst -Recurse -Force }
  Copy-Item -LiteralPath $uploadsSrc -Destination $uploadsDst -Recurse -Force
  Write-Ok 'public\uploads ripristinato'
}

# Eventuali log locali (se non sono in E:\HR\logs\ sibling)
$logsSrc = Join-Path $backupDir 'logs'
$logsDst = Join-Path $AppDir   'logs'
if ((Test-Path $logsSrc) -and -not (Test-Path $logsDst)) {
  Copy-Item -LiteralPath $logsSrc -Destination $logsDst -Recurse -Force
  Write-Ok 'logs\ ripristinato'
}

# CRITICAL: la subdir 'iis\' è il physicalPath del sito IIS
# (hr.epartner.it punta a E:\www\hr\iis\). Se non la ripristiniamo dal
# backup, IIS restituisce 500.19 ERROR_PATH_NOT_FOUND su ogni URL.
# Incidente storico: 2026-04-17 — sito down ~40min per questo motivo.
$iisSrc = Join-Path $backupDir 'iis'
$iisDst = Join-Path $AppDir   'iis'
if (Test-Path $iisSrc) {
  if (Test-Path $iisDst) { Remove-Item -LiteralPath $iisDst -Recurse -Force }
  Copy-Item -LiteralPath $iisSrc -Destination $iisDst -Recurse -Force
  Write-Ok 'iis\ (web.config sito) ripristinato'
} else {
  Write-WarnStep 'iis\ non trovato nel backup — se il sito IIS punta a iis\ subdir, darà 500.19. Verificalo con: appcmd list vdir /app.name:"hr.epartner.it/"'
}

# ─── 6. Start service ────────────────────────────────────────────────
Write-Step "Avvio servizio $ServiceName"
& $Nssm start $ServiceName | Out-Null
Start-Sleep -Seconds 3
$status = (& $Nssm status $ServiceName).Trim()
if ($status -ne 'SERVICE_RUNNING') {
  throw "Il servizio non è partito (stato: $status). Controlla $AppDir\logs\ o E:\HR\logs\stderr.log."
}
Write-Ok "Servizio running ($status)"

# ─── 7. Health check ─────────────────────────────────────────────────
if (-not $SkipHealthCheck) {
  Write-Step "Health check $HealthUrl"
  $ok = $false
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) {
        Write-Ok "Health OK (try $($i+1)): $($r.Content.Trim())"
        $ok = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ok) {
    Write-WarnStep "Health endpoint non risponde dopo 20s. Il servizio è running ma non ancora pronto — verifica i log."
  }
}

# ─── 8. Prune vecchi backup ──────────────────────────────────────────
Write-Step "Pulizia backup (keep ultimi $KeepBackups)"
$backups = Get-ChildItem -Path $parent -Directory -Filter "$appName.bak-*" |
  Sort-Object Name -Descending
if ($backups.Count -gt $KeepBackups) {
  $toDelete = $backups | Select-Object -Skip $KeepBackups
  foreach ($b in $toDelete) {
    Remove-Item -LiteralPath $b.FullName -Recurse -Force
    Write-Ok "Rimosso vecchio backup: $($b.Name)"
  }
} else {
  Write-Ok "Backup totali: $($backups.Count) (≤ $KeepBackups, niente da pulire)"
}

# ─── Done ────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host "  Deploy completato" -ForegroundColor Green
Write-Host "  BUILD_ID precedente: $currentBuildId" -ForegroundColor Green
Write-Host "  BUILD_ID nuovo:      $newBuildId" -ForegroundColor Green
Write-Host "  Backup:              $backupDir" -ForegroundColor Green
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host 'Per rollback:'
Write-Host "  $Nssm stop $ServiceName confirm"
Write-Host "  Remove-Item -LiteralPath '$AppDir' -Recurse -Force"
Write-Host "  Move-Item -LiteralPath '$backupDir' -Destination '$AppDir'"
Write-Host "  $Nssm start $ServiceName"
