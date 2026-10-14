# Example mixed monorepo

This is a **structure example**, not a runnable Laravel or Tauri project. Select the appropriate template from [`profiles/`](../../profiles/) and manually copy or merge its `AGENTS.md` and `.opencode/` files into each target directory.

```text
acme/
  AGENTS.md
  .opencode/opencode.jsonc
  apps/
    admin/        (Laravel)  .opencode/opencode.jsonc + AGENTS.md
    api/          (Laravel)  .opencode/opencode.jsonc + AGENTS.md
    desktop/      (Tauri)    .opencode/opencode.jsonc + AGENTS.md
  packages/
    php/auth/
    js/ui/
    rust/core/
```

1. Apply `profiles/monorepo-root` to `acme/`.
2. Apply `profiles/laravel-app` independently to `acme/apps/admin/` and `acme/apps/api/`.
3. Apply `profiles/tauri-app` to `acme/apps/desktop/`.
4. Add `profiles/library` rules to shared packages as needed.
5. Start app-scoped OpenCode sessions from each app root so that each Boost MCP uses the correct Laravel app.

Do not overwrite existing local rules without review. See the [main README](../../README.md#project-profiles) and [monorepo guide](../../docs/monorepo.md).
