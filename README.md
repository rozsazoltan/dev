# opencode-for-me

Personal [OpenCode](https://opencode.ai/) configuration and curated [APM](https://github.com/microsoft/apm) dependencies. Windows Desktop + WSL; manually maintained and reviewed in Git.

## Layout

| Path | Purpose |
| --- | --- |
| `config/` | OpenCode settings, agent instructions, plugin config, prompts, WSL template |
| `apm.yml` | Curated third-party skill dependencies |
| `skillsets.yml` | Technology → skill mapping (**reference only**, not an OpenCode feature) |
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
Copy-Item ./config/opencode.jsonc, ./config/AGENTS.md, ./config/dcp.jsonc, ./config/oh-my-opencode-slim.jsonc -Destination $target -Force
Copy-Item ./config/prompts, ./config/oh-my-opencode-slim -Destination $target -Recurse -Force
```

`config/wsl.jsonc` is a separate WSL starting point; adjust its Windows mount path for your machine. Keep credentials in a local `.secrets/` folder, never in Git. The OpenCode configuration is preserved as supplied; check version-specific keys against your installed OpenCode before applying it.

To expose the latest OpenCode Desktop CLI in PowerShell, dot-source [`scripts/opencode-desktop.ps1`](scripts/opencode-desktop.ps1) in your `$PROFILE`:

```powershell
. 'C:\path\to\opencode-for-me\scripts\opencode-desktop.ps1'
```

## APM skills

`apm.yml` is the tracked source of dependencies. `skillsets.yml` documents which skills belong to Vue, PHP, Laravel, Rust, Tauri, etc.; it does **not** selectively activate them. The `.apm/` files in this repo are snapshots, not live user settings.

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

The GitHub workflow updates the repository only; it does not update local or global OpenCode installations. `.agents/skills/` and other generated skill output are intentionally not versioned here. Third-party skill sources retain their licenses.

## License

[MIT](LICENSE)
