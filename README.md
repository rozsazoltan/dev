# opencode-for-me

Personal repository: `rozsazoltan/opencode-for-me`. A version-controlled, **low-autonomy** OpenCode V2 environment for Windows Desktop + PowerShell and WSL. Designed for mixed monorepos (PHP libraries, Laravel apps, JavaScript packages, Rust crates, Tauri apps) and ordinary single repositories.

This repository is a **personal configuration template assembled from the supplied settings**, not an upstream OpenCode distribution. It contains no credentials or machine-specific secret files. It does not automatically install packages or change the machine when cloned.

## Repository

Planned GitHub location: `https://github.com/rozsazoltan/opencode-for-me` (link becomes usable once published). The repository folder is `opencode-for-me`; OpenCode application configuration folders such as `~/.config/opencode/` keep their original names.

## Start here

1. Read [Architecture](docs/architecture.md), [Install on Windows](docs/setup-windows.md) or [Install on WSL](docs/setup-wsl.md).
2. Run `python scripts/validate.py` to check JSON/JSONC syntax and repository structure.
3. Review the global files under [`config/opencode/`](config/opencode/) and **back up existing live configurations**.
4. Apply using `scripts/install-windows.ps1` or `scripts/install-wsl.sh` (both dry-run by default).
5. Install the separate **planning-with-files skill**, and Snip CLI if desired; see [Tool installation](docs/tool-installation.md).
6. Use the [single repository](docs/single-repo.md) or [monorepo](docs/monorepo.md) guide to activate selective project profiles.
7. Check [verification](docs/verification.md) and [token measurement](docs/token-measurement.md).

## Layout

```text
config/opencode/               Global OpenCode V2 configuration and prompts
config/apm/apm.yml             Global APM manifest seed (no automatic packages)
profiles/                      Project templates: base, Laravel, Vue, Tauri, library
skills/                        Small owned skills; not copies of vendor skills
scripts/                       Windows / WSL installation and validation
examples/                      Monorepo and single-repo filesystem examples
docs/                          Architecture, operations, updates, measurements
catalog/TOOLING.md             Inventory: installed vs. available vs. project-only
```

## The operating policy

- Normal conversation stays in the main Orchestrator thread.
- Delegation is **ask-before-launch**, primarily using named Slim specialists; no automatic testing authoring.
- Persistent planning applies to *explicit coding tasks*, with minimal overhead for small edits.
- Deepwork remains available via `/deepwork` on demand; its automatically invokable skill is excluded.
- MCPs and skills are least-privilege; Laravel Boost runs only inside a Laravel workspace.
- The plugin is not the CLI: Snip and planning-with-files need separately installed components.

## Important distinctions

- `config/opencode/*.jsonc` are live *user config* source files, copied/symlinked into `~/.config/opencode/`.
- `profiles/*` are **templates**, not files OpenCode discovers automatically. Copy/symlink into the **target project's** `.opencode/`.
- OpenCode V2 merges configurations found from the **session working directory upward**. Opening an app's file while remaining in the monorepo root does **not** activate that app's child configuration.
- Bundled OMO-Slim skills register in process; they do not need copies under a `skills/` directory.
- APM is for optional third-party skills; installing everything globally is intentionally avoided.
- Runtime/project secrets and `.env` files are never committed.

## Upstream references

- [OpenCode V2 configuration](https://opencode.ai/v2/docs/config), [MCP servers](https://opencode.ai/v2/docs/mcp-servers), [skills](https://opencode.ai/v2/docs/skills), [permissions](https://opencode.ai/v2/docs/permissions)
- [OMO-Slim configuration](https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/docs/configuration.md)
- [Planning with Files / OpenCode](https://github.com/OthmanAdi/planning-with-files/blob/master/docs/opencode.md)
- [DCP](https://github.com/Tarquinen/opencode-dynamic-context-pruning)
- [Snip](https://github.com/edouard-claude/snip) and [OpenCode Snip plugin](https://github.com/VincentHardouin/opencode-snip)
- [Microsoft APM](https://github.com/microsoft/apm), [Laravel Boost](https://laravel.com/docs/boost)

> Compatibility: targeted at OpenCode **V2** and the user's `oh-my-opencode-slim@2` ecosystem (October 2026). Validate installed versions and plugin schemas before applying, particularly when moving across major versions. See [Compatibility notes](docs/compatibility.md).

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Zoltan Rozsa. Third-party tools and referenced materials remain subject to their respective licenses.
