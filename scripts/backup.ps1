$ErrorActionPreference = "Stop"

$SourceDir = $env:KB_HOST_DATA_DIR
if (-not $SourceDir) {
  $SourceDir = "D:\kb-data"
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $SourceDir "backups"
$TargetDir = Join-Path $BackupRoot $Timestamp

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$Database = Join-Path $SourceDir "kb.sqlite3"
$Uploads = Join-Path $SourceDir "uploads"
$Processed = Join-Path $SourceDir "processed"

if (Test-Path $Database) {
  Copy-Item $Database (Join-Path $TargetDir "kb.sqlite3")
}

if (Test-Path $Uploads) {
  robocopy $Uploads (Join-Path $TargetDir "uploads") /E | Out-Null
}

if (Test-Path $Processed) {
  robocopy $Processed (Join-Path $TargetDir "processed") /E | Out-Null
}

Write-Host "Backup completed: $TargetDir"
