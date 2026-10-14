# opencode-for-me

My version-controlled OpenCode V2 setup for Windows Desktop, WSL, and repositories ranging from individual apps to mixed-language monorepos. It favors clear conversations, explicit delegation, scoped tools, and predictable token usage.

**Navigation:** [Get started](#get-started) · [Project profiles](#project-profiles) · [Optional tools](#optional-tools) · [Maintenance and measurement](#maintenance-and-measurement) · [Reference](#reference)

## Get started

The steps below are manual and deliberate. Nothing runs automatically when you clone this repository. **Choose Windows or WSL based on where your OpenCode backend actually runs**; a Windows Desktop service cannot automatically use WSL-only executables.

### 1. Prepare your environment

**Required:** Git and OpenCode V2 (Desktop or CLI). You also need Node.js/npm for the `planning-with-files` skill installation used by this setup.

**Optional:** [mise](https://mise.jdx.dev/) for managed CLI tools, [APM](https://github.com/microsoft/apm) for third-party skills, WSL for Linux development, and PHP/Composer for Laravel Boost. Install these only where needed.

```bash
git clone https://github.com/rozsazoltan/opencode-for-me.git
cd opencode-for-me
```

### 2. Install the global OpenCode configuration

The source files live in [`config/opencode/`](config/opencode/). The destination is `~/.config/opencode/` in the **selected runtime environment**. If you already have a configuration, compare and merge it rather than overwriting customized settings. These commands make a backup before copying.

**Windows PowerShell** (run from this repository's root):

```powershell
$target = Join-Path $HOME '.config\opencode'
if (Test-Path $target) {
    Copy-Item $target "$target.backup-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item '.\config\opencode\*' $target -Recurse -Force
```

**WSL / Linux** (run from this repository's root):

```bash
if [ -d "$HOME/.config/opencode" ]; then
  cp -a "$HOME/.config/opencode" "$HOME/.config/opencode.backup-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$HOME/.config/opencode"
cp -a config/opencode/. "$HOME/.config/opencode/"
```

The copied files include the global `AGENTS.md`, OpenCode settings, OMO-Slim presets and prompts, and DCP settings. **Do not copy secrets into the repository.** If you use symlinks from your dotfiles instead, remember that changes to symlink targets might not trigger hot reload.

### 3. Install the planning skill

The `opencode-planning-with-files` **plugin** is declared in [`opencode.jsonc`](config/opencode/opencode.jsonc); its corresponding **skill** is installed separately:

```bash
npx skills add OthmanAdi/planning-with-files --skill planning-with-files -g
```

OMO-Slim itself is installed by OpenCode from the `plugins` list. Its bundled skills do **not** need to be copied into your global `skills/` directory. A separate OMO-Slim CLI installation is optional.

### 4. Configure GitHub access (optional)

The sample configuration defines a GitHub MCP and reads its credential from `OPENCODE_GITHUB_TOKEN`. Provide that variable through a trusted user environment or secrets manager **for the process running the OpenCode service**. Never add the token to Git, your PowerShell profile, or terminal history.

If you do not use the GitHub MCP, set its `disabled` property to `true` in your live `opencode.jsonc` until you need it.

### 5. Start OpenCode and check the setup

```bash
opencode --version
opencode debug config
```

OpenCode Desktop users should confirm which **Windows service** is running; WSL users should run the commands in WSL. Start a new session after major agent or plugin changes. Check available commands with `opencode --help` if your installed V2 build differs.

#### Windows PowerShell: stable `opencode` command (optional)

OpenCode Desktop installs the CLI in versioned directories. The small, documented
[`scripts/powershell/opencode-desktop.ps1`](scripts/powershell/opencode-desktop.ps1)
file defines a function that resolves the newest installed Desktop CLI when called.
It **does not** install or update OpenCode, change PATH, or manage the service.

To use it, open your PowerShell profile (`notepad $PROFILE`), creating the file first
with `New-Item -ItemType File -Path $PROFILE -Force` if needed. Add this line,
replacing the path with the actual location of your clone:

```powershell
. "C:\path\to\opencode-for-me\scripts\powershell\opencode-desktop.ps1"
```

Reload and verify:

```powershell
. $PROFILE
Get-Command opencode -All
opencode --version
```

This function is available to **PowerShell sessions loading the profile only**;
it is not a system-wide executable and does not affect WSL or the Windows Desktop
service. See [Windows notes](docs/setup-windows.md).

## Project profiles

Profiles in [`profiles/`](profiles/) are **templates**, not automatically activated OpenCode features. Copy or merge an appropriate profile's `AGENTS.md` and `.opencode/` content into the target repository or app. Keep existing project-specific rules if they are already present.

| Profile | Apply to | Purpose |
| --- | --- | --- |
| `monorepo-root` | Monorepo root | Shared package boundaries and cross-package work |
| `laravel-app` | Each Laravel app separately | App-scoped Laravel Boost MCP and conventions |
| `vue-app` | Vue app | Frontend defaults without an always-on browser MCP |
| `tauri-app` | Tauri app | Rust/frontend boundaries and targeted checks |
| `library` | PHP, JS, or Rust package | Stable APIs and downstream compatibility |
| `base` | Other repositories | Minimal repository defaults |

For example, in **WSL/Linux**, to apply a Laravel profile to an app (replace the path):

```bash
app=/path/to/monorepo/apps/admin
mkdir -p "$app/.opencode"
cp -n profiles/laravel-app/AGENTS.md "$app/AGENTS.md"
cp -an profiles/laravel-app/.opencode/. "$app/.opencode/"
```

Review and merge any skipped existing files manually. Repeat for `apps/api` or other Laravel apps. In Windows Explorer or PowerShell, copy the same profile files to the equivalent app paths; do not overwrite existing rules without review.

**Important:** OpenCode resolves configuration from the session's working directory and its parents. A root-level monorepo session does **not** automatically load `apps/admin/.opencode/opencode.jsonc` when it opens an admin file. Start an app-scoped session from that app directory to activate its Boost MCP. Use a root session for cross-package changes.

See [single-repository examples](docs/single-repo.md) and [monorepo examples](docs/monorepo.md) for layouts and multi-app conventions.

## Optional tools

These are independent integrations: **install only what you intend to use.** The plugins declared in `opencode.jsonc` do not install every external CLI or project dependency.

### Snip CLI — shell-output reduction

The `opencode-snip` plugin is already declared, but the `snip` executable must be on the **OpenCode service's** PATH. If you manage CLI tools with mise, run this in the same Windows or WSL environment as that service:

```bash
mise use -g github:edouard-claude/snip@latest
mise exec -- snip --version
```

For a Windows GUI service, make mise's shim path available in the **Windows user/system PATH**, not just your interactive PowerShell profile, and restart the Desktop service after changing PATH. If release-asset detection fails, see [tool installation](docs/tool-installation.md) for alternatives.

### Laravel Boost — per Laravel application

From **each app root** (not from the monorepo root):

```bash
composer require laravel/boost --dev
php artisan boost:install
```

Then review the generated instructions and the `laravel-app` profile MCP definition. `php artisan boost:mcp` must run with that app as its working directory. Windows Desktop users whose PHP toolchain lives in WSL need an explicit WSL-aware MCP command; see [tool installation](docs/tool-installation.md).

### APM — curated additional skills

[`config/apm/apm.yml`](config/apm/apm.yml) is a **starter manifest with no third-party skills enabled**. After installing APM, review [the APM guide](docs/apm.md), choose a trusted skill, and dry-run it before a global install:

```text
apm install -g --target opencode <owner>/<repository> --skill <skill-name> --dry-run
```

Do not duplicate OMO-Slim bundled skills, and do not run `apm compile -g` against your hand-maintained global `AGENTS.md` without reviewing what it will generate. Track what is available versus installed in [`catalog/TOOLING.md`](catalog/TOOLING.md).

**Other opt-ins:** [Playwright](docs/tool-installation.md#optional-playwright) for real browser tasks; [local Unsloth models](docs/local-model.md) for a deliberately enabled local provider; [custom Tauri security skill](skills/README.md) for Tauri projects.

## Maintenance and measurement

- **Updates:** review upstream plugin changes before changing pinned versions in `config/opencode/opencode.jsonc`; use `mise upgrade github:edouard-claude/snip` for Snip when wanted. `latest` is not an automatic updater.
- **Reloads:** symlink target edits may not hot-reload. After changing prompts/config, use `opencode reload` if supported, or restart the relevant service/session when idle.
- **Measured usage:** compare similar tasks and include both Orchestrator and child-session tokens. OpenCode usage and Snip's output savings are **different metrics**.

```bash
opencode stats --json
snip gain --json  # only after installing Snip
```

See [token measurement](docs/token-measurement.md), [verification](docs/verification.md), and [troubleshooting](docs/troubleshooting.md).

## Reference

| Directory | Contents |
| --- | --- |
| [`config/`](config/) | Global OpenCode settings, prompts, DCP, and APM manifest |
| [`profiles/`](profiles/) | Reusable, project-specific configuration templates |
| [`skills/`](skills/) | Optional custom skills owned by this repository |
| [`examples/`](examples/) | Single-repository and monorepo examples |
| [`catalog/`](catalog/) | Inventory of tools and their activation scope |
| [`docs/`](docs/) | In-depth setup, compatibility, maintenance, and debugging guides |

Upstream: [OpenCode](https://opencode.ai/) · [OMO-Slim](https://github.com/alvinunreal/oh-my-opencode-slim) · [DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) · [Snip](https://github.com/edouard-claude/snip) · [Planning with Files](https://github.com/OthmanAdi/planning-with-files) · [Laravel Boost](https://laravel.com/docs/boost)

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Zoltan Rozsa. Third-party tools retain their own licenses.
