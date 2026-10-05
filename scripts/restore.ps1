<#
.SYNOPSIS
  Restores an Inkwell checkpoint.

.DESCRIPTION
  Safe by default: restores to a NEW folder beside the project and leaves the
  current installation alone, so a restore can never be the thing that loses
  your work. -InPlace overwrites, taking its own checkpoint first.
#>
[CmdletBinding()]
param([string]$Backup = '', [switch]$InPlace)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path (Split-Path -Parent $project) 'inkwell-backups'

if (-not $Backup) {
  if (-not (Test-Path $backupRoot)) { Write-Host "No checkpoints yet. Run .\scripts\backup.ps1"; return }
  Write-Host "Checkpoints in $backupRoot`n"
  Get-ChildItem $backupRoot -Filter *.zip | Sort-Object LastWriteTime -Descending | ForEach-Object {
    '{0,-44} {1,7:N1} MB   {2}' -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
  }
  Write-Host "`n  .\scripts\restore.ps1 -Backup <name>.zip            restore alongside"
  Write-Host "  .\scripts\restore.ps1 -Backup <name>.zip -InPlace   overwrite"
  return
}

if (-not (Test-Path $Backup)) {
  $candidate = Join-Path $backupRoot (Split-Path -Leaf $Backup)
  if (Test-Path $candidate) { $Backup = $candidate } else { throw "No such checkpoint: $Backup" }
}
$Backup = (Resolve-Path $Backup).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Backup)
$names = $zip.Entries | ForEach-Object { $_.FullName.Replace([char]92, [char]47) }
$zip.Dispose()
if ($names -notcontains 'src/server.js') { throw 'That archive is not an Inkwell checkpoint (no src/server.js).' }

if (-not $InPlace) {
  $target = Join-Path (Split-Path -Parent $project) ("inkwell-restored-" + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
  New-Item -ItemType Directory -Force $target | Out-Null
  Expand-Archive -Path $Backup -DestinationPath $target -Force
  Write-Host ''
  Write-Host 'Restored alongside your current install' -ForegroundColor Green
  Write-Host "  $target"
  Write-Host '  Your live project was not touched. To use it:'
  Write-Host "    cd `"$target`" ; npm install ; npm start"
  return
}

Write-Host 'Taking a safety checkpoint of the current state first...'
& (Join-Path $PSScriptRoot 'backup.ps1') -Label 'pre-restore'

$running = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*nodejs*' }
if ($running) { $running | Stop-Process -Force; Start-Sleep -Seconds 2 }

Get-ChildItem $project -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
  Remove-Item $_.FullName -Recurse -Force
}
Expand-Archive -Path $Backup -DestinationPath $project -Force

Write-Host ''
Write-Host 'Restored in place' -ForegroundColor Green
Write-Host '  node_modules was left alone. If dependencies differ, run: npm install'
