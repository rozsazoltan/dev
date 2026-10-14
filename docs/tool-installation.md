# Installation of external tools

**Nothing in this repository installs third-party binaries automatically.** These are opt-in steps. Always inspect upstream releases, use a trusted installer, and check the selected platform.

## OMO-Slim

`"oh-my-opencode-slim@2"` in OpenCode V2 `plugins` is enough to load the runtime plugin. The separate CLI is optional for diagnostics/installer use:

```bash
bunx oh-my-opencode-slim@2 doctor
```

Avoid `install --reset` over your customized settings. Slim bundled skills are registered **in-process**, so they are not expected to appear as directories under global `skills/`. A working `/deepwork` command does **not by itself** prove its skill is auto-invokable; this toolkit intentionally preserves the command while disabling the skill.

## Planning with Files (separate skill + plugin)

The OpenCode plugin provides tools (`pwf_init`, `pwf_status`, `pwf_check`), while the skill is installed separately:

```bash
npx skills add OthmanAdi/planning-with-files --skill planning-with-files -g
```

Depending on skill installer, the resulting global file may be `~/.agents/skills/planning-with-files/SKILL.md`, which OpenCode V2 discovers. The existing `opencode-planning-with-files@1` plugin spec is preserved from your configuration; upstream V2 docs currently describe a more exact `@1.2.0` form. Pin a tested precise version after verification.

## Snip CLI with mise (recommended if already using mise)

**Windows PowerShell and Linux WSL are separate installs.** In whichever environment runs the OpenCode backend:

```powershell
mise use -g github:edouard-claude/snip@latest
mise exec -- snip --version
mise upgrade github:edouard-claude/snip
```

The `github:` backend depends on release asset detection for your OS/architecture; if mise cannot identify an asset, use the upstream GitHub Releases manual binary or Go fallback. `latest` does **not** guarantee unattended automatic updates.

Windows GUI PATH: ensure the directory actually shown by `mise where github:edouard-claude/snip` / `mise settings` and your mise shim setup is in the effective **Desktop service** PATH. Do not assume an interactive profile is loaded. Verify `snip --version` before relying on the OpenCode plugin.

Alternative Go install:

```bash
go install github.com/edouard-claude/snip/cmd/snip@latest
```

Validate and measure:

```bash
snip --version
snip check -- git log -5
snip run -- git log -5
snip gain --json
```

The plugin intercepts supported shell calls, *not* every model token or every tool call. Compare full sessions separately.

## Laravel Boost (per application, not globally)

From **each** Laravel app root (`apps/admin`, `apps/api`, etc.):

```bash
composer require laravel/boost --dev
php artisan boost:install
php artisan boost:mcp  # direct invocation for troubleshooting; MCP client normally starts this
```

Follow installer prompts, review generated instructions/skills, and install only when this app's PHP, Composer and framework version supports it. The project profile `profiles/laravel-app/.opencode/opencode.jsonc` launches `php artisan boost:mcp` with `cwd: "."`; **run the OpenCode session from the app folder**, not from the monorepo root. If Windows Desktop lacks compatible PHP, use a Windows PHP toolchain or a verified `wsl.exe --cd <linux-app-absolute-path> -- php artisan boost:mcp` command in a project-local config; don't copy hard-coded WSL paths between apps.

## Optional Playwright

Use browser tooling only for actual interactive UI diagnosis. The disabled template `profiles/optional-playwright-mcp.jsonc` can be merged manually into a Vue app's project config. It is intentionally *not* active by default. For simpler tasks, Playwright CLI/skill may have lower tool-catalog overhead.
