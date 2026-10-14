# Example single repository

Choose a matching template under [`profiles/`](../../profiles/) and manually copy or merge its `AGENTS.md` and `.opencode/` directory into the project root. No installer is required.

For a standalone Laravel app, apply `profiles/laravel-app`, then from the **app root** run:

```bash
composer require laravel/boost --dev
php artisan boost:install
```

Start OpenCode from the app directory. Use `vue-app`, `tauri-app`, or `library` for other repository types. Read the [main README](../../README.md#project-profiles) and [single-repo guide](../../docs/single-repo.md).
