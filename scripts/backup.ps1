<#
.SYNOPSIS
  Takes a restorable checkpoint of the whole Inkwell installation.

.DESCRIPTION
  Writes a timestamped .zip to ..\inkwell-backups, deliberately outside the
  project so a bad restore cannot destroy the backups with it.

  Included: all source, the .env file, and storage\ (the database and every
  captured signature). Excluded: node_modules, rebuilt from package-lock.json.

  The server is paused while the copy runs. SQLite keeps a write-ahead log, and
  copying those files mid-write can capture a torn database.

  This file is ASCII only. Windows PowerShell reads .ps1 as ANSI unless it has
  a BOM, so a stray em dash decodes into characters that break the parse.
#>
[CmdletBinding()]
param([string]$Label = '')

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path (Split-Path -Parent $project) 'inkwell-backups'
New-Item -ItemType Directory -Force $backupRoot | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$safeLabel = if ($Label) { '-' + ($Label -replace '[^A-Za-z0-9._-]+', '-') } else { '' }
$zipPath = Join-Path $backupRoot "inkwell-$stamp$safeLabel.zip"

$running = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*nodejs*' }
if ($running) { Write-Host 'Pausing the server so the database copies cleanly...'; $running | Stop-Process -Force; Start-Sleep -Seconds 2 }

$exclude = @('node_modules', '.secrets', 'ui-check')
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "inkwell-backup-$stamp"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force $staging | Out-Null
Get-ChildItem $project -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination $staging -Recurse -Force
}

$manifest = @"
Inkwell checkpoint
==================
Taken   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')
Label   : $(if ($Label) { $Label } else { '(none)' })

CONTAINS PERSONAL DATA. storage\ holds every captured signature image and the
name of the person who made it, plus the IP they signed from. .env holds
SESSION_SECRET. Keep this file as protected as the server itself.

To restore:  .\scripts\restore.ps1 -Backup "<this file>"
Then:        npm install, npm start
"@
Set-Content (Join-Path $staging 'CHECKPOINT.txt') $manifest -Encoding utf8

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $staging -Recurse -Force

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$names = $zip.Entries | ForEach-Object { $_.FullName.Replace([char]92, [char]47) }
$entries = $zip.Entries.Count
$zip.Dispose()

$hasSrc = $names -contains 'src/server.js'
$hasEnv = $names -contains '.env'
$hasDb  = ($names | Where-Object { $_ -like 'storage/*.db' }).Count -gt 0

Write-Host ''
Write-Host 'Checkpoint written' -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host ("  {0:N1} MB, {1} files" -f ((Get-Item $zipPath).Length / 1MB), $entries)
Write-Host "  source $(if ($hasSrc) { 'yes' } else { 'MISSING' })  |  database $(if ($hasDb) { 'yes' } else { 'none yet' })  |  .env $(if ($hasEnv) { 'yes' } else { 'none yet' })"
if (-not $hasSrc) { Write-Warning 'Source is missing from the archive. Do not rely on this checkpoint.' }

if ($running) {
  Start-Process node -ArgumentList 'src/server.js' -WorkingDirectory $project -WindowStyle Hidden `
    -RedirectStandardOutput "$env:TEMP\inkwell.log" -RedirectStandardError "$env:TEMP\inkwell.err"
  Start-Sleep -Seconds 3
  Write-Host '  server restarted' -ForegroundColor DarkGray
}
