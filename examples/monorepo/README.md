# Example mixed monorepo

This is a non-executable **structure example**, not a complete Laravel or Tauri project. Copy compatible profile files into each actual application's `.opencode/` directory and customize each app's `AGENTS.md`.

```text
acme/
  AGENTS.md
  .opencode/opencode.jsonc
  apps/
    admin/           (Laravel)  .opencode/opencode.jsonc + AGENTS.md
    api/             (Laravel)  .opencode/opencode.jsonc + AGENTS.md
    desktop/         (Tauri)    .opencode/opencode.jsonc + AGENTS.md
  packages/
    php/auth/
    js/ui/
    rust/core/
```

Commands from the **opencode toolkit repo**:

```bash
python scripts/apply-profile.py monorepo-root /path/to/acme       # preview
python scripts/apply-profile.py laravel-app /path/to/acme/apps/admin
python scripts/apply-profile.py laravel-app /path/to/acme/apps/api
python scripts/apply-profile.py tauri-app /path/to/acme/apps/desktop
# Add --apply after checking the target paths; existing files are skipped.
```

Important: two Laravel apps need two separate PWF/Boost contexts and session working directories. Full guide: `docs/monorepo.md`.
