# Mixed-language monorepo guide

Example arrangement: many PHP libraries, JS packages, Rust crates, Laravel apps, Tauri apps. Each app may have different PHP, Node, Rust or framework versions and different secrets.

## Recommended filesystem

```text
acme-monorepo/
  AGENTS.md                           root-wide scope / package boundaries
  .opencode/opencode.jsonc            shared root config
  .planning/                          shared persistent planning
  apps/
    admin/                            Laravel A
      AGENTS.md
      .opencode/opencode.jsonc         own Boost MCP
      .opencode/oh-my-opencode-slim.jsonc
    api/                              Laravel B
      AGENTS.md
      .opencode/opencode.jsonc         own Boost MCP
    desktop/                          Tauri
      AGENTS.md
      .opencode/opencode.jsonc
  packages/
    php/auth/AGENTS.md
    js/ui/AGENTS.md
    rust/core/AGENTS.md
```

The `examples/monorepo/` tree in this toolkit provides placeholder files; replace any `AGENTS.md` with actual package constraints and commands.

## Attach templates

From the trusted repo root, copy the toolkit's `profiles/monorepo-root/.opencode/opencode.jsonc` into `./.opencode/opencode.jsonc` and the corresponding `AGENTS.md` to root. For each Laravel app, copy `profiles/laravel-app/{AGENTS.md,.opencode/*}` into that app. Repeat independently for second/third Laravel apps. For Tauri, use the Tauri profile; for a shared package, use the library profile.

WSL symlinks are also possible, but beware file watcher/hot reload issues. These templates use `cwd: "."` and assume the session working directory is each app root; they are not a runtime profile-switching API.

## OpenCode sessions

- `cd acme-monorepo && opencode` -> root config + root rules, **no child Laravel MCP**.
- `cd acme-monorepo/apps/admin && opencode` -> root + admin config (including admin Boost).
- `cd acme-monorepo/apps/api && opencode` -> root + api config (including api Boost).
- `cd acme-monorepo/apps/desktop && opencode` -> root + Tauri config.

A Desktop project's current workspace/root influences the effective config just as the CLI does; verify the actual working directory. File browsing in the root session does not hot-switch the active profile. To work across multiple apps simultaneously, prefer separate workspaces/sessions or an **explicit** root-level MCP setup with distinct server IDs and exact app `cwd` values (disabled by default until needed).

## Multiple Laravel Boost servers

Do not attach one root `laravel-boost` server and assume it discovers app A versus B. Boost is app-contextual. If root cross-app work absolutely requires both, configure two distinct names and explicit directories, e.g. `boost-admin` -> `cwd: "apps/admin"`, `boost-api` -> `cwd: "apps/api"`; enable selectively. This costs MCP context and may expose data from both apps to the agent. Prefer app-scoped sessions.

## Workflows

- Analyze cross-package impact in root session and document requirements once.
- Implement focused changes in the relevant app/package session; avoid automatic parallel writers modifying shared libraries.
- Run targeted checks separately for changed packages. Do not create tests unless requested.
- Summarize impacted shared packages and API/semver risks at merge time.
