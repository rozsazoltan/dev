<#
.SYNOPSIS
    Exposes the OpenCode Desktop CLI as the `opencode` command in PowerShell.

.DESCRIPTION
    OpenCode Desktop installs `opencode-cli.exe` inside versioned directories,
    for example:
      %APPDATA%\ai.opencode.desktop\cli\2.0.29-x64\opencode-cli.exe

    Adding one such directory to PATH is fragile: it becomes stale when
    Desktop upgrades. Dot-sourcing this file defines a PowerShell function
    that selects the newest installed Desktop CLI version on EVERY call.
    No installation, path modification, background process, or auto-update
    is performed by this script.

.SETUP
    From PowerShell, open your profile using: notepad $PROFILE
    If the profile does not exist, create it first:
      New-Item -ItemType File -Path $PROFILE -Force

    Add the following line to your profile, replacing the path with the
    location of your own clone:
      . "C:\path\to\dev\scripts\opencode-desktop.ps1"

    Reload it using:
      . $PROFILE

.EXAMPLE
    opencode --version
    opencode service status
    opencode api --help

.NOTES
    - This is a PowerShell FUNCTION, not a new `opencode.exe` on PATH.
    - Only PowerShell sessions that load your profile can use it.
    - It does not change which OpenCode Desktop background service is running.
    - WSL processes and Windows GUI applications cannot call this function.
    - The script selects the highest numbered installed x64/arm64 build,
      NOT necessarily the version of the currently running Desktop service.
    - If both architectures are present, verify the selected executable.
    - It never downloads, updates, starts, stops, or kills anything.
#>

function global:opencode {
    # `$env:APPDATA` points to the Windows user's Roaming application-data folder.
    $root = Join-Path $env:APPDATA 'ai.opencode.desktop\cli'

    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "OpenCode Desktop CLI directory not found: $root"
    }

    # The CLI directory names are versioned (e.g. 2.0.29-x64).
    # Sort as System.Version rather than as strings (so 2.0.10 > 2.0.9).
    # Ignore incomplete installs that do not contain opencode-cli.exe.
    $candidates = @(
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop |
            Where-Object { $_.Name -match '^\d+\.\d+\.\d+-(x64|arm64)$' } |
            ForEach-Object {
                $versionText = $_.Name -replace '-(x64|arm64)$', ''
                $binary = Join-Path $_.FullName 'opencode-cli.exe'
                if (Test-Path -LiteralPath $binary -PathType Leaf) {
                    [pscustomobject]@{
                        Version = [version]$versionText
                        Binary  = $binary
                    }
                }
            } |
            Sort-Object Version -Descending
    )

    if ($candidates.Count -eq 0) {
        throw "No versioned opencode-cli.exe found under $root"
    }

    # Forward every argument unchanged; preserve the native CLI exit code.
    & $candidates[0].Binary @args
}
