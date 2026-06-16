# ─────────────────────────────────────────────────────────────────────
# Builda e impacchetta Presenze HR per il deploy sul server IIS/NSSM.
#
# Eseguire DAL PC di sviluppo, dalla root del repo o da deploy\.
# Produce presenze-hr-deploy.zip nella root del repo e lo VALIDA con gli
# stessi controlli che fa publish-server.ps1 (server.js root + .next/BUILD_ID).
#
# Next standalone NON copia public/ e .next/static/ dentro standalone/:
# questo script li assembla a mano (vedi deploy/DEPLOY-SERVER.md).
#
# Esempi:
#   .\deploy\package.ps1                 # build + package + validate
#   .\deploy\package.ps1 -SkipBuild      # riusa il .next esistente
# ─────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    $m" -ForegroundColor Green }

if (-not $SkipBuild) {
  Write-Step 'Build di produzione (next build, output standalone)'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build fallito (exit $LASTEXITCODE)" }
}

if (-not (Test-Path '.\.next\standalone\server.js')) {
  throw '.next\standalone\server.js mancante — il build standalone non è presente (lancia senza -SkipBuild).'
}
$buildId = (Get-Content '.\.next\BUILD_ID' -Raw).Trim()
Write-Ok "BUILD_ID: $buildId"

# ─── Assembla lo stage (recipe da DEPLOY-SERVER.md) ──────────────────
Write-Step 'Assemblaggio pacchetto'
$stage = Join-Path $env:TEMP 'presenze-hr-deploy'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item -Recurse '.\.next\standalone\*' $stage
New-Item -ItemType Directory -Path "$stage\.next\static" -Force | Out-Null
Copy-Item -Recurse '.\.next\static\*' "$stage\.next\static"
Copy-Item -Recurse '.\public' "$stage\public"
New-Item -ItemType Directory -Path "$stage\prisma" -Force | Out-Null
Copy-Item '.\prisma\schema.prisma' "$stage\prisma\schema.prisma"
Copy-Item '.\deploy\env.production.template' "$stage\.env.template"

$zipPath = Join-Path $repo 'presenze-hr-deploy.zip'
Remove-Item $zipPath -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath $zipPath -Force
Write-Ok "Zip creato: $zipPath ($('{0:N1}' -f ((Get-Item $zipPath).Length/1MB)) MB)"

# ─── Validazione (stessi check di publish-server.ps1) ────────────────
Write-Step 'Validazione zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $norm = { param($s) $s -replace '\\', '/' }
  $hasServer = $zip.Entries | Where-Object { (& $norm $_.FullName) -eq 'server.js' } | Select-Object -First 1
  $hasSchema = $zip.Entries | Where-Object { (& $norm $_.FullName) -eq 'prisma/schema.prisma' } | Select-Object -First 1
  $hasBuild  = $zip.Entries | Where-Object { (& $norm $_.FullName) -eq '.next/BUILD_ID' } | Select-Object -First 1
  if (-not $hasServer) { throw 'Zip non valido: manca server.js alla root' }
  if (-not $hasSchema) { throw 'Zip non valido: manca prisma/schema.prisma' }
  if (-not $hasBuild)  { throw 'Zip non valido: manca .next/BUILD_ID (build incompleto?)' }
  $reader = New-Object System.IO.StreamReader($hasBuild.Open())
  $zipBuildId = $reader.ReadToEnd().Trim(); $reader.Close()
  if ($zipBuildId -ne $buildId) { throw "BUILD_ID nello zip ($zipBuildId) ≠ locale ($buildId)" }
  Write-Ok "OK: server.js + prisma/schema.prisma + .next/BUILD_ID=$zipBuildId ($($zip.Entries.Count) entries)"
} finally {
  $zip.Dispose()
}

Write-Host ''
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host "  Pacchetto pronto" -ForegroundColor Green
Write-Host "  BUILD_ID: $buildId" -ForegroundColor Green
Write-Host "  Zip:      $zipPath" -ForegroundColor Green
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host 'Prossimo: copia lo zip in E:\HR\incoming sul server, poi segui la skill hr-prod-deploy.'
