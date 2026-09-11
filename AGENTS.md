# Contributor and coding-agent instructions

## Project

- Windows-only Rust 2024 project. Prefer native Windows and WSL primitives.
- Use `mise` for project tooling and checks.
- Keep ownership boundaries clear:
  - `dev`: configuration, diagnostics, and self-update.
  - `wsldisk`: VHDX lifecycle.
  - `wslctl`: WSL distro and backup lifecycle.
- Use structured process arguments; never build shell command strings.
- Do not add functionality outside the current issue scope.

## Development workflow

- Never work directly on `master`.
- Before modifying files, verify that work is on a task-specific branch or worktree.
- If the current branch is `master`, or branch safety cannot be confirmed, stop before modifying the repository.
- Never commit, push, merge, rebase, force-push, or rewrite `master` directly unless explicitly instructed.

Before implementation, create a short numbered implementation plan.

Each numbered implementation step is a commit boundary:

- Implement only that step.
- Use TDD for behavior changes.
- Run the relevant tests or checks.
- Do not commit a known failing or incomplete state.
- Commit the step after it is verified.
- Use a Conventional Commit message for that step.
- Do not start the next step until the commit succeeds.
- Do not amend, squash, or rewrite previous commits unless explicitly instructed.

After all implementation steps, run:

`mise run check`

If final verification requires fixes, commit those fixes separately.

## Safety

- Never run destructive automated tests against real WSL distros or VHDX files.
- Normal automated tests must not require Administrator privileges or mutate real WSL/VHDX state.
- Keep destructive operations explicitly guarded.
- `--dry-run` must never perform mutations.
- `--debug` must show and confirm each external command before execution.
- A configured `dev` default WSL distro is required for infrastructure operations. Never silently use the Windows default distro.

## CLI behavior

- `--json` stdout must contain valid JSON only; diagnostics belong on stderr.
- Failed operations must return a non-zero exit code.

## Out of scope unless explicitly requested

- GUI
- Tauri
- MCP
- Git/worktree management as product functionality
- Mutagen
- workspace orchestration
- background services
