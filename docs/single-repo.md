# Single repository guide

## Laravel only

```text
my-laravel-app/
  AGENTS.md
  .opencode/opencode.jsonc
  .opencode/oh-my-opencode-slim.jsonc
```

Copy the corresponding files from `profiles/laravel-app/`, run `composer require laravel/boost --dev` and `php artisan boost:install` **inside the app**. Start OpenCode from the app root. Check the PHP executable visibility to the backend.

## Vue only

Copy `profiles/vue-app/` and fill in the local package manager/build scripts in `AGENTS.md`. Avoid installing a browser MCP until there's a real browser testing/debugging need.

## Tauri only

Copy `profiles/tauri-app/`. Record Rust workspace/Cargo tooling and Tauri permissions/capability policies in project `AGENTS.md`. Do not run enormous full-workspace checks by default.

## Plain package/library

Copy `profiles/library/`. Protect stable APIs and downstream consumers. Use a light plan only when you explicitly request coding.

## Why not activate all profiles globally?

Different Laravel apps may require different PHP runtimes, secrets and MCP working directories. Single-app profiles reduce unused tools and prevent accidental access across project boundaries.
