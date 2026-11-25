# Planning File Editing

- Follow installed `planning-with-files` skill when applicable.
- Read current file contents before modifying planning files.
- Prefer `edit` for targeted modifications and `write` for new files.
- Avoid `apply_patch` for `task_plan.md`, `findings.md`, `progress.md`, and `.planning/**/*.md`.
- Append progress and findings instead of rewriting entire files.
- Preserve existing sections, formatting, and historical entries.
- After failed edit, re-read file and choose different editing strategy.
- Never retry same failed patch unchanged.
- Verify file contents after editing.
