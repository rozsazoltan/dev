# Context Recovery

- Use the `planning-with-files` skill for every non-trivial task.
- Initialize or continue the planning files before substantial work starts.
- Select the plan belonging to this task; never recover an unrelated plan.
- Keep objectives, progress, decisions, findings, blockers, paths and remaining work on disk.
- Update the planning files when meaningful progress happens, not only at the end.

## Before Context Compaction

- Save the task state before anticipated compaction.
- Record completed and pending tasks, decisions, findings and important paths.
- Record errors, blockers and open questions.
- Record the next concrete actions needed to continue.
- Assume the next session sees only the planning files, not this conversation.

## After Context Compaction

1. Read this task's `task_plan.md`, `findings.md` and `progress.md` first.
2. Reconstruct the original request and its acceptance criteria.
3. Review completed work and pending work.
4. Check whether the task is already finished.
5. Inspect the actual project files and Git state.
6. Identify interrupted edits, missing verification or stale results.
7. Continue only the remaining work.
8. Re-run the relevant checks.
9. Update the planning files with the recovered state.

- Never treat a summary, a plan file or a resumed session as proof of completion.
- Never restart finished work; verify it and continue from the last verified state.
- If compaction was unexpected, persist the recovered state before further implementation.
