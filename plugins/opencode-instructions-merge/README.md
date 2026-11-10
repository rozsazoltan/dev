# OpenCode Instructions Merge

OpenCode V2 server plugin that reads explicit Markdown files and directories and injects their combined contents as **one system text part** before an agent model request.

- Supports any number of explicitly configured source files and shallow Markdown directories (up to 64 source paths).
- Preserves source order. Within each directory, sorts `*.md` files by filename.
- Re-reads files for every relevant model request, so edits take effect without restarting OpenCode.
- Deduplicates repeated files, skips symbolic links and non-Markdown files.
- Enforces per-file and total size limits.
- Does not rewrite user messages or persist merged instructions to disk.
- Does not read files other than configured sources and immediate Markdown children of configured directories.

## Install from shared monorepo

After this package is committed to `rozsazoltan/dev/plugins/opencode-instructions-merge`, add its package through the OpenCode V2 plugin manager:

```bash
opencode plugin add 'github:rozsazoltan/dev#master::path:plugins/opencode-instructions-merge'
```

The package is separate from APM's `plugin.json` bundles. **Do not assume `apm install` will install an executable OpenCode V2 server plugin.**

Use the *object form* in global `~/.config/opencode/opencode.jsonc` to pass options. Add this entry to the existing `plugins` array; preserve existing entries:

```jsonc
{
  "plugins": [
    {
      "package": "github:rozsazoltan/dev#master::path:plugins/opencode-instructions-merge",
      "options": {
        "sources": [
          "~/.config/opencode/instructions/rozsazoltan.md",
          "~/.config/opencode/instructions/git-worktrees.md",
          "~/.config/opencode/instructions/planning-files.md",
          "~/.config/opencode/instructions/caveman.md"
        ],
        "includeCompaction": true,
        "onMissing": "warn"
      }
    }
  ]
}
```

A full example appears in `examples/opencode.global.jsonc`. When OpenCode configuration already has the plugin listed as a string, **replace** that entry with the object form rather than enabling two copies.

To pin updates, use a full Git commit SHA in place of `main` after validating the package.

## Local development

For a local checkout of `dev` and a *global* `opencode.jsonc`, reference the plugin **directory** by absolute path. For example:

```jsonc
{
  "plugins": [
    {
      "package": "D:/github/rozsazoltan/dev/plugins/opencode-instructions-merge",
      "options": {
        "sources": ["~/.config/opencode/instructions"],
        "onMissing": "warn"
      }
    }
  ]
}
```

WSL example path: `/github/rozsazoltan/dev/plugins/opencode-instructions-merge`.

`~` resolves to the current user's home directory on both platforms. Relative instruction paths resolve from the **canonical project checkout**, not from the plugin's package directory and not from the current working directory. Prefer `~` or absolute paths for global instructions.

## Configuration options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sources` | `string[]` | required | Explicit `.md` files or directories; directories contribute their immediate `.md` children. |
| `includeCompaction` | `boolean` | `false` | Also inject same instructions into compaction requests. |
| `onMissing` | `"warn" \| "ignore" \| "error"` | `"warn"` | Missing or skipped source behavior. |
| `maxFileBytes` | `number` | `65536` | Maximum bytes per file (max: 1 MiB). |
| `maxTotalBytes` | `number` | `262144` | Combined maximum bytes (max: 4 MiB). |

One joined system text part is appended through `ctx.session.hook("context", ...)`, and optionally `ctx.session.hook("compaction", ...)`. Other system parts are not modified. Plugin does **not** affect titles or auxiliary generation requests. OpenCode native `AGENTS.md`, project instructions, policies and higher-priority system rules still apply.

## Migrating your current AGENTS.md

1. Copy desired text into separate Markdown files under `~/.config/opencode/instructions/` (starter content included in `examples/instructions/`).
2. Keep current global `AGENTS.md` until plugin loads and instructions work in an OpenCode session.
3. After verification, remove or slim **duplicate** text from global `AGENTS.md`, and remove any duplicated files from OpenCode's built-in `instructions` array.
4. Keep project-level `AGENTS.md` files for project-specific rules. Global plugin supplements, not overrides, those instructions.

The plugin injects configured Markdown as model instructions. Configure **trusted files only**; never include credentials, `.env`, `.secrets`, or untrusted repository material. Source filenames appear inside the model context; absolute paths are not included in the injected text, but configured file contents are sent to the model.

## Development and validation

```bash
cd plugins/opencode-instructions-merge
npm install
npm test
npm run typecheck
opencode plugin list
```

Unit tests run under Node.js 22+. Runtime needs the OpenCode version whose API exposes `@opencode/plugin` and `ctx.session.hook("context", ...)` (OpenCode V2).

**Validation status:** On Node.js 26.12.1 and npm 11.20.0, `npm install --ignore-scripts`, all seven unit tests, TypeScript typecheck, and a local plugin-module import passed. Remote Git subdirectory loading and live OpenCode integration remain unverified.

## Troubleshooting

- No instructions loaded: confirm `options.sources` points to existing files in *the OpenCode server process's filesystem* (important for WSL and remote servers).
- Duplicate instructions: remove matching content from legacy global `AGENTS.md` or built-in `instructions` entries.
- On Windows, use `D:/github/...` absolute plugin paths for local installs; use `/github/...` or `/mnt/d/...` as appropriate within WSL.
- Missing files produce warnings by default; use `onMissing: "error"` when every source is mandatory.
- Plugin fails in OpenCode V1: upgrade/port separately; V1 plugin API is intentionally unsupported here.

## Official docs

- https://opencode.ai/docs/build/plugins
- https://opencode.ai/docs/build/plugins/server
- https://opencode.ai/docs/plugins/
