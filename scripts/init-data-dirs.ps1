$ErrorActionPreference = "Stop"

$DataDir = $env:KB_HOST_DATA_DIR
if (-not $DataDir) {
  $DataDir = "D:\kb-data"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "processed") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "tmp") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "backups") | Out-Null

Write-Host "Data directories ready: $DataDir"
