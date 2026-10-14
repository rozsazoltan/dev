<#
.SYNOPSIS
  Safe installer for the user-level Windows OpenCode Desktop config.
.DESCRIPTION
  Default is preview. -Apply copies only missing files. -Apply -Replace makes
  timestamped backups before overwriting. Does not install binaries or secrets.
#>
param(
    [switch]$Apply,
    [switch]$Replace
)

$ErrorActionPreference = 'Stop'
if ($Replace -and -not $Apply) {
    throw 'Use -Replace together with -Apply.'
}
$repository = Split-Path -Parent $PSScriptRoot
$sourceConfig = Join-Path $repository 'config\opencode'
$targetConfig = Join-Path $HOME '.config\opencode'
$sourceApm = Join-Path $repository 'config\apm\apm.yml'
$targetApm = Join-Path $HOME '.apm\apm.yml'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$files = @(
    'opencode.jsonc',
    'AGENTS.md',
    'oh-my-opencode-slim.jsonc',
    'dcp.jsonc',
    'prompts/command.md',
    'oh-my-opencode-slim/codex/orchestrator_append.md'
)

function Install-Copy([string]$source, [string]$target) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing source: $source"
    }
    $exists = Test-Path -LiteralPath $target
    if ($exists -and -not $Replace) {
        Write-Host "SKIP  exists: $target"
        return
    }
    if (-not $Apply) {
        Write-Host "PLAN  $source -> $target"
        return
    }
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if ($exists) {
        $backup = "$target.backup-$timestamp"
        Copy-Item -LiteralPath $target -Destination $backup -Force
        Write-Host "BACKUP $backup"
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "COPY  $target"
}

foreach ($item in $files) {
    Install-Copy (Join-Path $sourceConfig $item) (Join-Path $targetConfig $item)
}
Install-Copy $sourceApm $targetApm
if (-not $Apply) {
    Write-Host "`nDry-run complete. Re-run with -Apply; use -Replace only after reviewing existing files."
}
