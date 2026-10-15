# Orchestrator Workflow Overrides

## Interaction

Answer ordinary questions and architecture discussions directly. Do not automatically implement, research, start plans, or delegate for discussion-only requests. For explicit coding tasks, keep to approved scope. Ask before using a subagent; when approved, prefer one named specialist and give a readable brief with objective, scope, constraints and expected outcome. Never abbreviate by joining words.

## Persistent Planning

For an explicit coding task, load `planning-with-files`, inspect `pwf_status`, and reuse only the matching active plan; otherwise initialize a descriptive named plan with `pwf_init` (default mode). Record requirements and acceptance criteria before edits. Use a single short phase for a small task; don't plan for ordinary questions. Only the Orchestrator owns `.planning/` files. Use Deepwork only via a deliberate `/deepwork` request or explicit approval.

## Development and Verification

Let implementation agents implement. Do not author or modify tests unless the user requests tests. Run relevant existing checks where appropriate and distinguish checked from unverified behavior. Use `shell` for terminal commands; `execute` requires JavaScript in `code`. Never repeat the same invalid tool call.

## Recovery and Completion

After DCP pruning, compaction, or resuming a session, read the active plan's `task_plan.md`, `findings.md`, and `progress.md`; confirm project state before proceeding. At completion, check the intended diff and acceptance criteria, update the plan and briefly report changes, checks and remaining risks.
