# dev

My OpenCode setup and the APM skills I use: Windows desktop plus WSL, reviewed by hand before anything is applied.

## Layout

| Path | What it is |
| --- | --- |
| `config/` | OpenCode settings, agents, plugins, prompts |
| `apm.yml` | Full skill set for the global install |
| `presets/*/apm.yml` | Per-project installable skill sets |
| `.apm/` | Snapshots of user-level APM settings |
| `scripts/` | Local helpers |
| `.github/workflows/update-apm-skills.yml` | Manual APM update that opens a pull request |

Third-party skills come from their own repositories. First-party ones live in [`rozsazoltan/skills`](https://github.com/rozsazoltan/skills).

## OpenCode

Copy what you need from `config/` into `$HOME/.config/opencode/` (`%USERPROFILE%\.config\opencode\` on Windows). Back up the target first.

```powershell
$target = Join-Path $HOME '.config/opencode'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item ./config/opencode.jsonc, ./config/opencode-wsl.jsonc, ./config/AGENTS.md, ./config/dcp.jsonc, ./config/oh-my-opencode-slim.jsonc -Destination $target -Force
Copy-Item ./config/prompts, ./config/oh-my-opencode-slim -Destination $target -Recurse -Force
```

`opencode.jsonc` is the Windows config and `opencode-wsl.jsonc` the WSL one. Both sit in the Windows config directory; WSL gets a symlink to the WSL file:

```bash
win_home="$(wslpath -u "$(cmd.exe /C 'echo %USERPROFILE%' | tr -d '\r')")"
win_config="$win_home/.config/opencode/opencode-wsl.jsonc"
if [ -f "$win_config" ]; then
  mkdir -p "$HOME/.config/opencode"
  ln -s "$win_config" "$HOME/.config/opencode/opencode.jsonc"
else
  printf 'Missing Windows config: %s\n' "$win_config" >&2
fi
```

`ln -s` will not overwrite an existing file, so back up any WSL config first. Adjust the Windows skills path in `opencode-wsl.jsonc` if your username or location differs.

Credentials belong in a local `.secrets/` folder, never in Git. This is the config I actually run, not a neutral default, so check version-specific keys against your OpenCode build.

To get the Desktop CLI in PowerShell, dot-source [`scripts/opencode-desktop.ps1`](scripts/opencode-desktop.ps1) from `$PROFILE`:

```powershell
. 'C:\path\to\dev\scripts\opencode-desktop.ps1'
```

## Skills

Install the global preset once per user:

```bash
apm install rozsazoltan/dev/presets/global -g --target opencode
```

The `-g` flag writes `~/.apm/apm.yml` and deploys the skills to `~/.config/opencode/skills/`.

For a project, run this from the project root and take only what that project needs:

```bash
apm install rozsazoltan/dev/presets/vue --target opencode
apm install rozsazoltan/dev/presets/gsap --target opencode
apm install rozsazoltan/dev/presets/laravel --target opencode
apm install rozsazoltan/dev/presets/rust --target opencode
apm install rozsazoltan/dev/presets/tauri --target opencode
```

| Preset | Skills |
| --- | --- |
| `global` | `general` + `anti-slop` |
| `general` | writing-for-agents, planning-with-files |
| `anti-slop` | deslop, humanizer, hallmark |
| `javascript` | antfu, Vite, Vitest, pnpm |
| `vue` | `javascript` + Vue, Vue best practices |
| `gsap` | GSAP core, frameworks, performance, plugins, React, ScrollTrigger, timelines, utilities |
| `php` / `laravel` | Pest 4 only; no general PHP or Laravel skill picked yet |
| `rust` / `tauri` | Apollo Rust best practices; no Cargo or Tauri skill picked yet |
| `oxc-migration` | migrate-oxlint, migrate-oxfmt, for migration work |

Presets stay self-contained, so dependencies may overlap. APM deduplicates them and pins the result in the consuming project's `apm.lock.yaml`. Updating a preset here does not update projects that already installed it; run `apm update` there.

The root `apm.yml` is the full set for this machine. Validate it locally, then refresh the global copy:

```powershell
apm install --target opencode
Copy-Item ./apm.yml, ./apm.lock.yaml -Destination (Join-Path $HOME '.apm') -Force
apm install -g --target opencode --frozen
```

Neither the workflow nor this repository touches installed skills. Generated output such as `.agents/skills/` stays out of Git, and third-party skills keep their own licenses.

## Extra CLI tools

[bin](https://github.com/marcosnils/bin) installs release binaries; run it on the OS that needs them.

```sh
bin install https://github.com/jesseduffield/lazygit
bin install https://github.com/jesseduffield/lazydocker
bin install https://github.com/craigloewen-msft/lazywslc
bin install https://github.com/dandavison/delta
bin install https://github.com/dorssel/usbipd-win
bin install https://github.com/edouard-claude/snip
bin install https://github.com/mutagen-io/mutagen

bin update
```

`lazywslc` and `usbipd-win` are Windows only. For `usbipd-win` the system service and driver are a separate step in the [upstream installer](https://github.com/dorssel/usbipd-win#how-to-install).

`snip` belongs on the same machine as [@rozsazoltan/opencode-shell](https://github.com/rozsazoltan/opencode-shell) if you want its shell-output filtering. The plugin runs without it, but the snip wrapping stays off. Keep `snip` on the OpenCode server's `PATH` or in `~/bin`.

## mise

**Windows:** download the matching `windows-x64` or `windows-arm64` executable from [jdx/mise releases](https://github.com/jdx/mise/releases/latest), rename it to `mise.exe`, and put it on `PATH`.

```powershell
New-Item -ItemType Directory -Force 'D:\program\bin' | Out-Null
Copy-Item '.\mise-v*-windows-x64.exe' 'D:\program\bin\mise.exe'
mise --version
mise self-update
```

A standalone binary updates with `mise self-update`, not `mise upgrade`, which upgrades the tools mise manages.

**Fedora and supported RHEL:**

```bash
sudo dnf copr enable jdxcode/mise
sudo dnf install -y mise
sudo dnf upgrade --refresh mise
```

**Debian and Ubuntu:**

```bash
sudo apt install -y extrepo
sudo extrepo enable mise
sudo apt update
sudo apt install -y mise
```

Package-manager installs update through DNF or APT, never `mise self-update`. Check with `mise --version` and `mise doctor`. The [official guide](https://mise.jdx.dev/installing-mise.html) covers distro-specific requirements.

## License

[MIT](LICENSE)
