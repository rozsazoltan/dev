# Contributor and coding-agent instructions

- This is a Windows-only project. Prefer native Windows and WSL primitives.
- Use Rust 2024 and `mise` for the toolchain and project commands.
- Keep ownership boundaries clear:
  - `dev` owns configuration, diagnostics, and self-update.
  - `wsldisk` owns VHDX lifecycle.
  - `wslctl` owns WSL distro and backup lifecycle.
- Use structured process arguments, never shell command strings.
- Use TDD for behavior changes and run `mise run check` before finishing an issue.
- Do not add functionality outside the current issue scope.

## Safety

- Never run destructive automated tests against real WSL distros or VHDX files.
- Normal automated tests must not require Administrator privileges or mutate real WSL/VHDX state.
- Keep destructive operations explicitly guarded.
- `--dry-run` must never perform mutations.
- `--debug` must show and confirm each external command before execution.
- A configured `dev` default WSL distro is required for infrastructure operations. Never silently use the Windows default distro.

## CLI behavior

- Keep `--json` output machine-readable.
- When `--json` is used, stdout must contain JSON only; diagnostics belong on stderr.
- Failed operations must return a non-zero exit code.

## Out of scope unless explicitly requested

```text
GUI
Tauri
MCP
Git/worktrees
Mutagen
workspace orchestration
background services
```
