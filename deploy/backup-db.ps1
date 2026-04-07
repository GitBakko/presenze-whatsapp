# Backup del database SQLite di produzione.
# Esegui prima di ogni deploy, oppure schedulato ogni notte con
# Task Scheduler (utente SYSTEM, trigger daily 02:00).

param(
  [string]$DbPath     = "E:\HR\data\prod.db",
  [string]$BackupDir  = "E:\HR\backups",
  [int]$KeepDays      = 30
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DbPath)) { throw "DB non trovato: $DbPath" }
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $BackupDir "prod-$timestamp.db"

# Copia atomica: SQLite e' un singolo file, finche' non c'e' una
# transazione WAL attiva la copia bitwise e' safe. Per extra safety
# si puo' usare `sqlite3 .backup`, ma richiede sqlite3.exe installato.
Copy-Item -Path $DbPath -Destination $dest -Force
Write-Host "Backup: $dest ($([math]::Round((Get-Item $dest).Length / 1KB)) KB)"

# Pulizia backup vecchi
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $BackupDir -Filter "prod-*.db" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Host "Rimosso backup vecchio: $($_.Name)"
    Remove-Item $_.FullName -Force
  }
