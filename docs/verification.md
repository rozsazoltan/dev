# Runtime verification checklist

This repository deliberately ships **no validation script**. Validate the live runtime using its own CLI and a few bounded checks.

1. Confirm `opencode --version` and inspect the merged configuration with `opencode debug config` where supported.
2. Inspect available plugin commands with `opencode plugin --help`, then the loaded plugins if your version supports listing them.
3. Run a harmless read-only shell command (`git status --short`) in an Orchestrator session.
4. Ask a discussion-only question: it should answer without plans or subagents.
5. Request a small scoped coding change: delegation should require user approval when supported by the integration.
6. Try `/deepwork` explicitly; a command being available does not prove its skill is automatically invokable.
7. Verify `pwf_status` after the planning plugin **and** skill are installed.
8. If Snip is installed, run `snip --version` and `snip gain --json` in the server's real environment.
9. For each Laravel app, verify its OpenCode session starts in the correct app directory and Boost can resolve the right `artisan` executable.

## Common mismatch symptoms

- `execute: code Missing key`: Code Mode received `shell`-shaped arguments; not a Git syntax failure.
- Only 2–3 skills shown in UI: may indicate UI filtering, in-process Slim bundled registrations, or a plugin problem. A slash command alone is not conclusive.
- `snip: command not found`: the service cannot resolve the CLI; fix that environment's install/PATH.
- `General` subagents: inspect the actual agent ID, not only its visible title.
- Wrong Laravel MCP working directory: inspect the session workspace, not merely the open file.
