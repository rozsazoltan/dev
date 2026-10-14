# Monorepo Working Agreement

- Map affected packages and app consumers before touching shared code.
- Do not execute all-app tests or full-tree searches without approval; prefer targeted package scopes.
- Preserve package boundaries and existing version/lockfile conventions.
- Start application-scoped sessions from the application directory for app-specific MCP settings.
- Only the root Orchestrator owns shared `.planning/` notes; avoid parallel edits to them.
