# APM skill management

APM (`microsoft/apm`) can install agent skills globally for OpenCode or in individual repos. The seed `config/apm/apm.yml` intentionally installs **nothing until curated**; this prevents duplicate Slim skills or a large context catalog by accident.

## Global user manifest

Global manifest location: `~/.apm/apm.yml`. The installer can copy this repository's `config/apm/apm.yml` there. Keep the manifest and the generated lockfile in a private dotfiles repo if reproducibility is important; this template does not invent a lockfile.

Example opt-in command (review provider ownership/version first):

```bash
apm install -g --target opencode anthropics/skills --skill frontend-design --dry-run
# If the dry run resolves the intended skill, repeat without --dry-run.
```

An alternate source is `anthropics/skills/skills/frontend-design`. The source and exact package model must be confirmed against the current APM CLI. Other categories worth curating for your stack: debugging, API design, security, Vue UI, PHP architecture, Tauri security. Do **not** install overlapping planning/orchestration skillsets globally without a specific reason.

## Project-local

A project may have an `apm.yml` in its root; run `apm install --target opencode` from **that repository**. In a monorepo, prefer one root manifest for shared skills, and specialized per-app manifests only when you have verified APM's root detection for nested workspaces.

## Avoid unintended overwrite

`apm compile -g` can modify the user's global `AGENTS.md`; this repository maintains that file manually. **Do not run `apm compile -g` by default.** `apm install` deploys skills without requiring a compilation of global instructions. For global APM manifests, keep `targets: [opencode]` so compilation scope is explicit if you do decide to run it.

An APM global manifest may need to be a **regular file**, not a symlink, for compilation. When using dotfiles, copy the manifest or confirm `apm compile` can read it in your installed APM release.

## Operational checklist

1. Inspect the upstream `SKILL.md`, license and content; treat dependencies as executable instructions.
2. Test install with `--dry-run` and check destination under `~/.config/opencode/skills/`.
3. Record rationale, scope and source in `catalog/TOOLING.md`.
4. Keep a lockfile only after the real installer has resolved versions.
5. Remove redundant skill directories when Slim already supplies the same skill ID.
