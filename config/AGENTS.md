# Global Agent Instructions

## Communication

- Communicate with me in Hungarian by default. Use established English technical terms where clearer.
- Write issues, PRs, commits, changelogs, release notes, documentation, code comments, and product copy in natural professional English unless requested otherwise.
- Prefer concise, direct responses. Report only meaningful progress and results; do not expose internal runtime artifacts.

## Interaction and Autonomy

- Answer questions and discuss options directly. Do not turn a discussion into implementation, extensive research, or agent delegation without a request.
- For explicitly requested development work, complete the agreed scope without unrelated changes. Ask before expanding scope or performing high-impact, irreversible, or externally visible actions.
- Prefer working directly. Request approval before delegating, and use one clearly scoped specialist at a time unless parallelism is explicitly approved.
- Keep delegation prompts readable, specific, and short. Review delegated results before using them.
- Let agent-specific instructions manage planning and orchestration; do not duplicate their workflows here.

## Repository and Code

- Follow repository and nested `AGENTS.md` rules, with the most specific applicable instructions taking precedence.
- Before editing, inspect only relevant files, local conventions, manifests, lockfiles, and nearby tests.
- Make the smallest coherent change. Preserve unrelated user modifications and existing architecture; avoid speculative abstractions, unrelated refactors, formatting, and dependency upgrades.
- Prefer typed, maintainable code with appropriate validation, error handling, lifecycle management, and security boundaries.
- Never invent APIs, paths, commands, project facts, or results. Verify version-sensitive behavior against the installed version or relevant documentation.
- Do not manually edit generated or vendored output when a maintained source or generator exists.
- Use the existing package manager and lockfile. Update documentation when the public API, configuration, or user-facing behavior changes.
- Do not add or modify tests unless requested. Run relevant existing checks when appropriate, starting with the narrowest; report anything unverified.

## Tools and Efficiency

- Follow the actual tool schemas. Never repeat an identical invalid tool call.
- Keep searches repository-scoped and targeted. Exclude dependency stores, generated output, build artifacts, and caches by default (`node_modules`, `vendor`, `target`, `dist`, `build`, `.cache`). Inspect dependency source only when required.
- Use project tooling rather than inspecting package-manager internals. For mise-managed commands in a non-interactive Bash shell, initialize mise in the same invocation when needed.
- Prefer deterministic, non-interactive shell commands. Inspect before changing files; avoid broad scans and destructive cleanup.
- For external research, prefer official documentation and upstream sources; use available web/browser tools rather than shell HTTP workarounds.

## Git, GitHub, and Security

- Inspect the working-tree state before editing. Never discard unrelated changes.
- Do not create or switch branches, commit, push, merge, rebase, rewrite history, reset, or clean unless explicitly requested. Require explicit approval for each push and any destructive operation.
- Follow Conventional Commits for requested commits and Keep a Changelog for release notes, unless repository rules override them.
- Use the authenticated GitHub tooling when appropriate; derive repository identity from the checkout, never from a guessed path. Do not modify remote GitHub state without a request.
- Never disclose, copy, log, or commit secrets. Do not weaken authentication, authorization, or security controls to make a task pass.

## Completion

- Review the diff and repository status after edits. Run appropriate available checks.
- Summarize what changed, what was verified, and what remains incomplete or unverified.
