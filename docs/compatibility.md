# Compatibility and migration notes

## Preserved from the supplied configuration

- Plugin set: planning-with-files, Slim 2.x, DCP, Snip 3.0.0-next.1.
- MCP: GitHub Copilot remote endpoint; now token comes from environment rather than a repository-relative secret file.
- OMO-Slim `codex` / `session` model presets and six specialists.
- DCP range compression, error purge after four turns, and protected tool patterns.
- OpenCode compaction keep=20k, buffer=8192.
- Optional local Unsloth/Qwen provider recorded as *inactive* template.
- Windows Desktop CLI version discovery via PowerShell profile snippet.

## Deliberate changes

- OpenCode V2 naming `agents` / `permissions` / `shell` / `subagent` rather than old `agent` / `permission` / `bash` / `task`.
- Approval before child delegation; no unattended wake; fewer MCPs exposed to the Orchestrator.
- PWF for explicit coding requests only. Deepwork auto-skill disabled while `/deepwork` command kept.
- DCP `experimental.allowSubAgents=false` as a conservative baseline; it is not asserted as a fix for concatenated words.
- Slim Fixer moved from `xhigh` to `high` for an initial cost experiment; restore `xhigh` if validation quality regresses.
- Removed unrecognized/no-op `not-used-plugins` list and legacy `experimental.policies` in favor of V2 root `policies`.
- `windowsHide` omitted until confirmed against the installed OpenCode V2 schema.

## Warnings

- Some upstream READMEs still show OpenCode V1 `plugin` singular and `tool.execute.before` shell hooks; this repo targets V2 and uses `plugins` plural. Always inspect the installed **Snip plugin 3.0.0-next.1** implementation if it fails.
- The V2 static validator validates JSONC syntax only, not plugin runtime schema semantics or model availability.
- Existing session model / tool routing may not change until a fresh session or service reload.
- Arbitrary `extends`/`include` inside OpenCode JSONC is **not** assumed. Profiles are manually linked/copied to recognized locations.
- Do not run `apm compile -g` casually against your curated `AGENTS.md`.
- The optional provider uses the precise model IDs supplied by the user, which may depend on a specific local server build.
