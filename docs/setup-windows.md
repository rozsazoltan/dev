# Windows 11 + OpenCode Desktop setup

Use PowerShell, Windows Desktop's own service, and Windows-native CLI tooling. Running WSL and Windows OpenCode simultaneously can give you **two different PATHs, service connections and usage stores**.

## 1. Snapshot existing state

```powershell
Get-Command opencode -All
Get-Command snip -All -ErrorAction SilentlyContinue
Get-ChildItem "$env:APPDATA/ai.opencode.desktop/cli" -Directory
```

Back up your active `~/.config/opencode` files and `~/.apm/apm.yml`. The installer below is dry-run first and never reads or copies secrets from this repository.

## 2. Apply global configuration

From repository root:

```powershell
.\scripts\install-windows.ps1
.\scripts\install-windows.ps1 -Apply
```

Existing files are **not overwritten** without `-Replace`; if replacing, the installer writes a timestamped backup first. Inspect the diff manually. Install the optional Unsloth provider block only if you use it; see [Local provider](local-model.md).

## 3. Stable `opencode` command in PowerShell

Open your profile (`notepad $PROFILE`), create its parent first if necessary. Append **one** line, do not replace the rest of your profile:

```powershell
. "C:\path\to\opencode-for-me\scripts\powershell\opencode-desktop.ps1"
```

That script defines a PowerShell function named `opencode`, which finds the highest **semantic version** of the installed Desktop CLI at `%APPDATA%\ai.opencode.desktop\cli\<version>-x64\opencode-cli.exe`. The running GUI service may be a different version until its next restart. Test:

```powershell
. $PROFILE
Get-Command opencode -All
opencode --version
opencode service status
```

**Note:** PowerShell functions are available in shells that load your profile; other programs (IDE subprocesses, GUI apps) cannot use the function like a real executable. For those, use the full CLI path or a separately managed launcher/shim.

## 4. Snip Windows PATH

See [tool installation](tool-installation.md). If using mise, prefer its **shims directory** on the machine/user PATH for GUI services; `mise activate` in your PowerShell profile alone is insufficient for a separately launched Desktop process.

Confirm the binary in the same Windows environment:

```powershell
Get-Command snip
snip --version
snip check -- git log -5
```

After changing the user PATH, quit/restart the Desktop app and its background service when work is idle. A new terminal reading the PATH does not retroactively update an already-running service.

## 5. Secrets

Set `OPENCODE_GITHUB_TOKEN` in a trusted Windows credential manager or user process environment. The template reads `{env:OPENCODE_GITHUB_TOKEN}`. Never store the token in repo, PowerShell profile, PS history, shell transcripts or issue reports. If no token is configured, disable the GitHub MCP until needed. The remote MCP service's required scopes and endpoint behavior may change.

## 6. Check

```powershell
python .\scripts\validate.py
opencode --version
opencode service status
```

Proceed to [troubleshooting](troubleshooting.md) if a service port is occupied.
