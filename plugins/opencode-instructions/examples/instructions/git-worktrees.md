# Git Worktrees

- Keep Git worktrees under `<repo>/.worktrees/<name>`, using configured `worktree.directory`.
- Never create worktrees in temporary directories or outside configured location.
- Inspect `git worktree list --porcelain` before creating, removing, or reusing worktrees.
- Use descriptive, filesystem-safe worktree names. Avoid collisions.
- Ensure `.worktrees/` is excluded by repository `.gitignore`.
- Never remove or overwrite existing worktrees, branches, or uncommitted changes without explicit approval.
- Prefer OpenCode built-in worktree tools. Use `git worktree` commands when necessary.
