# Troubleshooting: Windows Desktop, WSL, ports, hot reload

## Managed service port is already in use

Your earlier Windows Desktop service process was `opencode-cli.exe serve --service` under a versioned Desktop CLI path. This is normal when Desktop is running; **do not kill it blindly** or assume WSL OpenCode should start a second service on the same port.

PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 49374 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "ProcessId = 2784" | Select-Object ProcessId,Name,ExecutablePath,CommandLine
```

The example PID and port are from an earlier observation; do not assume the same PID remains valid after reboot. Use the actual process ID returned by the first command. WSL: `ss -ltnp '( sport = :49374 )'`. Confirm the correct backend and support for connecting to an existing server by reading `opencode api --help` / `opencode --help`. Changing service port is a fallback **only after** determining which process owns it.

## Symlinked configuration does not hot reload

OpenCode and Slim may snapshot prompt/skill config at session or plugin startup; WSL filesystem watchers can miss Windows-target symlink changes. When available, run `opencode reload` from the relevant runtime, then start a fresh session if the prompt still appears stale. Otherwise restart the service safely after completing active tasks. Avoid multiple simultaneous symlinked `.json` and `.jsonc` files for one config: V2 precedence may surprise you.

## Windows PowerShell profile function

A PS function named `opencode` only exists in PowerShell processes that loaded the profile. OpenCode Desktop subprocesses do not automatically inherit PowerShell functions. The [documented PowerShell snippet](../scripts/powershell/opencode-desktop.ps1) finds the newest semver CLI on each invocation. Dot-source it from `$PROFILE` as shown in the [README](../README.md#windows-powershell-stable-opencode-command-optional). Verify `Get-Command opencode -All`. See [setup](setup-windows.md).

## Starship timeout in `System32`

`starship::context: Scanning current directory timed out` is a separate prompt/performance warning, not proof of a broken OpenCode service or Snip integration. Test commands from your repository root and adjust Starship scan settings independently.
