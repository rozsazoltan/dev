# Runtime verification checklist

1. Run `python scripts/validate.py`: syntax/static layout, not a runtime guarantee.
2. Use `opencode --version`, `opencode debug config` (if supported) to inspect the real merged config.
3. Check active plugin list using `opencode plugin --help` / `opencode plugin list` where available.
4. Test a harmless shell command in the main Orchestrator: `git status --short`.
5. Ask a discussion-only question. It should answer without PWF initialization or subagents.
6. Ask a small explicitly scoped code edit and inspect whether it requests approval before delegation.
7. Explicitly try `/deepwork` and verify the command still works even if its skill is not advertised.
8. Ask for `pwf_status` after installing **both** PWF plugin and skill.
9. Check `snip --version`, `snip gain --json` **in the server's actual environment**.
10. Launch two separate Laravel application workspaces and verify each Boost process points to the correct `artisan` directory.

## Common mismatch symptoms

- `execute: code Missing key`: model selected JavaScript Code Mode but supplied `shell`-style arguments; not a Git syntax failure.
- Only 2-3 skills shown in UI: may be list filtering, bundled skills loaded in-process, or plugin failure. A slash command is not proof that its corresponding skill is loaded.
- `snip: command not found`: plugin cannot invoke the CLI from the service PATH; fix OS-specific install/PATH first.
- Subagent named `General`: check actual agent ID; disable built-in general in V2 and test specialized Slim routing, but UI label alone can be ambiguous.
- MCP not running at app folder: inspect OpenCode's session cwd, not just the currently opened file path.
