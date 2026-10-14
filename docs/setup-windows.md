# Windows 11 + OpenCode Desktop

Follow the [README Get started](../README.md#get-started) first. Installation is manual: this repository deliberately has **no bootstrap or validation scripts**.

## Global configuration

Run the PowerShell copy commands in the main README from this repository's root. Back up existing settings and merge your own changes. The runtime config lives in `$HOME\.config\opencode\`; the `opencode-for-me` repository itself remains the editable source.

## Stable PowerShell command

The optional [`opencode-desktop.ps1`](../scripts/powershell/opencode-desktop.ps1) defines a PowerShell function that resolves the newest versioned `opencode-cli.exe` distributed with OpenCode Desktop. It is a **dot-sourced profile snippet, not an installer**. From your PowerShell `$PROFILE` add this line, replacing the path with the actual checkout path:

```powershell
. "C:\path\to\opencode-for-me\scripts\powershell\opencode-desktop.ps1"
```

Reload with `. $PROFILE`, then check `Get-Command opencode -All` and `opencode --version`. The script includes inline explanation, requirements, limitations, and examples.

A PowerShell profile function is **not** a globally discoverable executable for other processes. It only exists in PowerShell sessions that have loaded the profile.

## Windows vs WSL

The Desktop service runs in **Windows**; WSL has a separate environment and PATH. Install Snip with mise on Windows if the Desktop service uses it. For GUI applications, mise's shims directory must be on the Windows process PATH; profile-only `mise activate` is not sufficient. Restart Desktop and the service after PATH changes, when no tasks are running.

Confirm:

```powershell
Get-Command snip -All -ErrorAction SilentlyContinue
snip --version
opencode service status
```

## Credentials

The bundled GitHub MCP reads `OPENCODE_GITHUB_TOKEN` from the OpenCode service environment. Use a secure environment/credential mechanism, never a checked-in file or terminal history. Disable the GitHub MCP in the live config if no credential is available.

For version changes, MCP configuration, service problems, and reload behavior, see [troubleshooting](troubleshooting.md).
