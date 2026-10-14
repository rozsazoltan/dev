# Example single repository

For a standalone Laravel app:

```bash
python scripts/apply-profile.py laravel-app /path/to/my-laravel-project
python scripts/apply-profile.py laravel-app /path/to/my-laravel-project --apply
cd /path/to/my-laravel-project
composer require laravel/boost --dev
php artisan boost:install
```

Use `vue-app`, `tauri-app` or `library` in place of `laravel-app` for other project types. This installer does **not** copy secrets, run Composer, or start an OpenCode service for you.
