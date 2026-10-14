# Dot-source from $PROFILE. Keeps up with the versioned OpenCode Desktop CLI.
# Example: . "C:\path\to\opencode-for-me\scripts\powershell\opencode-desktop.ps1"
function global:opencode {
    $root = Join-Path $env:APPDATA 'ai.opencode.desktop\cli'
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "OpenCode Desktop CLI directory not found: $root"
    }

    $candidates = @(
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop |
            Where-Object { $_.Name -match '^(?<semver>\d+\.\d+\.\d+)-(x64|arm64)$' } |
            ForEach-Object {
                $versionText = $_.Name -replace '-(x64|arm64)$', ''
                $binary = Join-Path $_.FullName 'opencode-cli.exe'
                if (Test-Path -LiteralPath $binary -PathType Leaf) {
                    [pscustomobject]@{ Version = [version]$versionText; Binary = $binary }
                }
            } |
            Sort-Object Version -Descending
    )

    if ($candidates.Count -eq 0) {
        throw "No versioned opencode-cli.exe found under $root"
    }

    & $candidates[0].Binary @args
}
