# Configuration architecture

## Layers

```text
OS user (Windows or WSL):
  ~/.config/opencode/opencode.jsonc
  ~/.config/opencode/AGENTS.md
  ~/.config/opencode/oh-my-opencode-slim.jsonc
  ~/.config/opencode/dcp.jsonc
  ~/.config/opencode/oh-my-opencode-slim/codex/orchestrator_append.md
  ~/.apm/apm.yml

Trusted repo root:
  .opencode/opencode.jsonc     <-- shared settings
  AGENTS.md                    <-- shared repo instructions

app under monorepo (when OpenCode launched FROM app):
  apps/admin/.opencode/opencode.jsonc
  apps/admin/.opencode/oh-my-opencode-slim.jsonc
  apps/admin/AGENTS.md
```

OpenCode V2 discovers project configs **upward from the current working directory**. Config merging is not lazy per file-open; an app's MCP does not become enabled from a root-scoped session. OpenCode direct and `.opencode` config styles have different merge precedence; keep to `.opencode/opencode.jsonc` in this toolkit.

## Files that are templates versus live

| File | Runtime location | Mode |
|---|---|---|
| `config/opencode/opencode.jsonc` | `~/.config/opencode/opencode.jsonc` | live global config |
| `config/opencode/AGENTS.md` | `~/.config/opencode/AGENTS.md` | live global instructions |
| `config/opencode/dcp.jsonc` | `~/.config/opencode/dcp.jsonc` | DCP plugin config |
| `config/opencode/oh-my-opencode-slim.jsonc` | `~/.config/opencode/oh-my-opencode-slim.jsonc` | Slim plugin config |
| `config/opencode/oh-my-opencode-slim/codex/orchestrator_append.md` | corresponding subpath under global config dir | Slim prompt supplement |
| `config/apm/apm.yml` | `~/.apm/apm.yml` | optional global APM manifest |
| `profiles/*` | manually copied/symlinked into project directories | not auto-loaded by OpenCode |
| `catalog/TOOLING.md` | stays in this repository | inventory, not instructions |

## Architectural boundaries

- **Plugins** run inside OpenCode runtime and may define hooks/agents/tools. Changes may require runtime reload or a full restart.
- **MCPs** are external capabilities with separate processes, credentials and startup costs; attach only to apps or agents that need them.
- **Skills** are knowledge/workflow prompts loaded on invocation. Slim bundled skills are virtual registrations; APM skills are on disk.
- **Prompts** should define *policy*, not replicate a whole plugin's internal orchestration procedure.
- **Profiles** are standalone configuration examples; there is no assumed arbitrary JSONC `extends` of a second file.

## Least-autonomous defaults

`agents.orchestrator.permissions.subagent: ask` acts as a user approval boundary on native V2 calls. The prompt separately encourages direct dialogue. A third-party plugin may implement delegation differently; verify with one real task. Disabling native `general`/`explore` does not disable Slim's `explorer` agent. Background wake is disabled to avoid unattended continuation. Do not declare that these settings guarantee a particular token budget.

## Named plans in monorepos

The root `.planning/` may be shared; only the main Orchestrator writes it. When running concurrent sessions at different app directories, inspect the PWF plugin's project-root resolution: use `PWF_PLAN_ROOT` / `PLAN_ID` where necessary, to avoid attaching a plan from a sibling app.
