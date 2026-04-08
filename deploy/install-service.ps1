# Installa il servizio Windows "PresenzeHR" che avvia il server Next.js
# in standalone mode all'avvio del server. Richiede NSSM.
#
# Prerequisiti:
#   - Node.js 20 LTS installato in C:\Program Files\nodejs\node.exe
#   - NSSM in C:\Tools\nssm\nssm.exe (scaricato da https://nssm.cc)
#   - Il pacchetto Next.js estratto in E:\HR\app (con .env e node_modules)
#   - E:\HR\data esistente e scrivibile
#
# Esegui da PowerShell admin.

param(
  [string]$ServiceName = "PresenzeHR",
  [string]$Nssm        = "C:\ProgramData\chocolatey\bin\nssm.exe",
  [string]$NodeExe     = "C:\Program Files\nodejs\node.exe",
  [string]$AppDir      = "E:\HR\app",
  [string]$ServerJs    = "E:\HR\app\server.js",
  [string]$LogDir      = "E:\HR\logs"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Nssm))     { throw "NSSM non trovato: $Nssm" }
if (-not (Test-Path $NodeExe))  { throw "Node non trovato: $NodeExe" }
if (-not (Test-Path $ServerJs)) { throw "server.js non trovato: $ServerJs" }
if (-not (Test-Path $LogDir))   { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# Se il servizio esiste gia', fermalo e rimuovilo
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "Servizio $ServiceName gia' presente, rimuovo..."
  & $Nssm stop    $ServiceName confirm | Out-Null
  & $Nssm remove  $ServiceName confirm | Out-Null
}

Write-Host "Installo il servizio $ServiceName..."
& $Nssm install $ServiceName $NodeExe $ServerJs

# Directory di lavoro = cartella dell'app (server.js usa path relativi)
& $Nssm set $ServiceName AppDirectory $AppDir

# Account: LocalSystem (default di NSSM e' gia' cosi', ma espliciti)
& $Nssm set $ServiceName ObjectName LocalSystem

# Avvio automatico al boot
& $Nssm set $ServiceName Start SERVICE_AUTO_START

# Nome visualizzato + descrizione
& $Nssm set $ServiceName DisplayName "Presenze HR (Next.js)"
& $Nssm set $ServiceName Description "Servizio Next.js del portale HR Presenze, proxy IIS su https://hr.epartner.it"

# Log rotativi in E:\HR\logs
& $Nssm set $ServiceName AppStdout  "$LogDir\stdout.log"
& $Nssm set $ServiceName AppStderr  "$LogDir\stderr.log"
& $Nssm set $ServiceName AppRotateFiles  1
& $Nssm set $ServiceName AppRotateOnline 1
& $Nssm set $ServiceName AppRotateBytes  10485760  # 10 MB

# Restart automatico in caso di crash
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 5000

Write-Host ""
Write-Host "Installato. Avvio il servizio..."
& $Nssm start $ServiceName

Start-Sleep -Seconds 2
& $Nssm status $ServiceName

Write-Host ""
Write-Host "Done. Verifica con:"
Write-Host "  Invoke-WebRequest http://127.0.0.1:3100/api/kiosk/health | Select-Object -ExpandProperty Content"
