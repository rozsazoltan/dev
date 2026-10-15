# dev

Personal [OpenCode](https://opencode.ai/) configuration and curated [APM](https://github.com/microsoft/apm) dependencies. Windows Desktop + WSL; manually maintained and reviewed in Git.

## Layout

| Path | Purpose |
| --- | --- |
| `config/` | OpenCode settings, agent instructions, plugin config, prompts, Windows/WSL configs |
| `apm.yml` | Full skill collection for global installation |
| `presets/*/apm.yml` | Installable, project-specific APM skill collections |
| `.apm/` | Versioned **snapshots** of user-level APM settings and marketplaces |
| `scripts/` | Optional local helper scripts |
| `.github/workflows/update-apm-skills.yml` | On-demand APM update → pull request |

No skills are authored in this repository. My own skills will live in [`rozsazoltan/skills`](https://github.com/rozsazoltan/skills) and be installed via APM once published. Globally installed skills remain outside this Git repository.

## OpenCode

Install the reviewed files from `config/` into your OpenCode user configuration directory (`$HOME/.config/opencode/`; on Windows, `%USERPROFILE%\.config\opencode\`). For example, from the repository root in **PowerShell**:

```powershell
$target = Join-Path $HOME '.config/opencode'
# Back up the existing target before overwriting any files.
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item ./config/opencode.jsonc, ./config/opencode-wsl.jsonc, ./config/AGENTS.md, ./config/dcp.jsonc, ./config/oh-my-opencode-slim.jsonc -Destination $target -Force
Copy-Item ./config/prompts, ./config/oh-my-opencode-slim -Destination $target -Recurse -Force
```

The `opencode.jsonc` file is for Windows; `opencode-wsl.jsonc` is for WSL. Both live in the **Windows** OpenCode configuration directory. In **WSL Bash**, link the WSL config to the Windows file using OpenCode's expected filename:

```bash
# Requires WSL interop (cmd.exe) and the Windows setup above.
win_home="$(wslpath -u "$(cmd.exe /C 'echo %USERPROFILE%' | tr -d '\r')")"
win_config="$win_home/.config/opencode/opencode-wsl.jsonc"
if [ -f "$win_config" ]; then
  mkdir -p "$HOME/.config/opencode"
  ln -s "$win_config" "$HOME/.config/opencode/opencode.jsonc"
  readlink -f "$HOME/.config/opencode/opencode.jsonc"
else
  printf 'Missing Windows config: %s\n' "$win_config" >&2
fi
```

This creates `~/.config/opencode/opencode.jsonc` (WSL symlink) → `/mnt/c/Users/<WindowsUser>/.config/opencode/opencode-wsl.jsonc` (Windows file). `ln -s` intentionally **does not overwrite** an existing WSL config; back it up before creating the link. Adjust the Windows skills path inside `config/opencode-wsl.jsonc` if your username or location differs.

Keep credentials in a local `.secrets/` folder, never in Git. The OpenCode configuration is preserved as supplied; check version-specific keys against your installed OpenCode before applying it.

To expose the latest OpenCode Desktop CLI in PowerShell, dot-source [`scripts/opencode-desktop.ps1`](scripts/opencode-desktop.ps1) in your `$PROFILE`:

```powershell
. 'C:\path\to\dev\scripts\opencode-desktop.ps1'
```

## APM skills

The root `apm.yml` contains all curated skills for global use. Each `presets/<name>/apm.yml` is an independently installable APM package for a local project. `.apm/` contains snapshots of user-level CLI settings, not active repository configuration.

```bash
# From the repository root: resolve and validate dependencies locally.
apm install --target opencode

# Review and commit apm.lock.yaml (if created).
# GitHub: Actions → Update APM Skills → Run workflow → review PR.
```

After approval, synchronize the reviewed `apm.yml` and `apm.lock.yaml` to the active **global** APM directory (`~/.apm/`), then deploy using your installed APM version. Example in PowerShell:

```powershell
$globalApm = Join-Path $HOME '.apm'
New-Item -ItemType Directory -Force -Path $globalApm | Out-Null
# Back up existing global APM files before running these commands.
Copy-Item ./apm.yml, ./apm.lock.yaml -Destination $globalApm -Force
apm install -g --target opencode --frozen
```

### Project presets

From **your project's root directory** (not this repository), add only the skills you need:

```bash
# Vue 3 / TypeScript / Vite / Vitest / pnpm
apm install rozsazoltan/dev/presets/vue --target opencode

# Laravel / Pest
apm install rozsazoltan/dev/presets/laravel --target opencode

# Rust / Cargo
apm install rozsazoltan/dev/presets/rust --target opencode

# Tauri (currently Rust guidance)
apm install rozsazoltan/dev/presets/tauri --target opencode

# Compose presets when needed
apm install rozsazoltan/dev/presets/general rozsazoltan/dev/presets/vue --target opencode
```

Available presets:

| Preset | Skills |
| --- | --- |
| `general` | writing-for-agents, planning-with-files |
| `javascript` | antfu, Vite, Vitest, pnpm (also TypeScript) |
| `vue` | antfu, Vue, Vue best practices, Vite, Vitest, pnpm |
| `php` / `laravel` | Pest 4 only; no general PHP/Laravel skill selected yet |
| `rust` / `tauri` | Apollo Rust best practices; no dedicated Cargo/Tauri skill selected yet |
| `ui` | hallmark |
| `oxc-migration` | migrate-oxlint, migrate-oxfmt (migration tasks only) |

Each preset is intentionally self-contained (dependencies may overlap). APM resolves and deduplicates transitive packages, then records them in the consuming project's `apm.lock.yaml`. Local projects manage their own versions; updating these presets here does not silently update existing projects. Use `apm update` inside a consuming project to refresh its pinned dependencies.

Once [`rozsazoltan/skills`](https://github.com/rozsazoltan/skills) is published, add selected first-party skills to the relevant presets. No skill sources live in this repository.

The GitHub workflow updates the repository only; it does not update local or global OpenCode installations. `.agents/skills/` and other generated skill output are intentionally not versioned here. Third-party skill sources retain their licenses.

## Extra CLI tools

Install release binaries with [bin](https://github.com/marcosnils/bin) (run on the OS where you need the tool):

```sh
bin install https://github.com/jesseduffield/lazygit
bin install https://github.com/jesseduffield/lazydocker
bin install https://github.com/craigloewen-msft/lazywslc
bin install https://github.com/dandavison/delta
bin install https://github.com/dorssel/usbipd-win
bin install https://github.com/edouard-claude/snip
bin install https://github.com/mutagen-io/mutagen

# Update bin-managed executables
bin update
```

`lazywslc` and `usbipd-win` are Windows-oriented. `bin install` retrieves the release executable; for `usbipd-win`, installing the system service/driver (if needed) is a separate step covered by the [upstream installer](https://github.com/dorssel/usbipd-win#how-to-install).

**snip:** Install it on the same machine as [@rozsazoltan/opencode-shell](https://github.com/rozsazoltan/opencode-shell) to enable the plugin's shell-output filtering. The plugin can also run without snip (mise environment handling is independent), but snip-based wrapping will be unavailable. Make sure `snip` is on the OpenCode server's `PATH` (or in `~/bin`).

## mise (jdx/mise)

**Windows (standalone executable):** Download the latest matching Windows `.exe` from [jdx/mise releases](https://github.com/jdx/mise/releases/latest) (`windows-x64` for x64; `windows-arm64` for ARM64). Copy it to `D:\program\bin\mise.exe` (rename the downloaded executable to `mise.exe`). Ensure `D:\program\bin` is on `PATH`.

```powershell
New-Item -ItemType Directory -Force 'D:\program\bin' | Out-Null
# From the download folder; keep only the desired architecture's release file.
Copy-Item '.\mise-v*-windows-x64.exe' 'D:\program\bin\mise.exe'
mise --version
mise self-update
```

When installed from a standalone GitHub release binary, update mise itself with `mise self-update` (not `mise upgrade`, which upgrades tools managed *by* mise).

**Fedora / supported RHEL (DNF):** Enable the mise COPR repository, install, and later upgrade using DNF:

```bash
sudo dnf copr enable jdxcode/mise
sudo dnf install -y mise
sudo dnf upgrade --refresh mise
```

**Debian / Ubuntu (APT):** Enable the mise package repository using `extrepo`, then install and update using APT:

```bash
sudo apt install -y extrepo
sudo extrepo enable mise
sudo apt update
sudo apt install -y mise
# Later:
sudo apt update
sudo apt install --only-upgrade -y mise
```

For package-manager installations, **update via DNF/APT**, not `mise self-update`. Check with `mise --version` and `mise doctor`. See the [official mise installation guide](https://mise.jdx.dev/installing-mise.html) for distro/version-specific requirements.

## License

[MIT](LICENSE)
