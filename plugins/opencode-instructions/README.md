# OpenCode Instructions Merge

OpenCode V2 server plugin that reads explicit Markdown files and directories and injects their combined contents as **one system text part** before an agent model request.

- Supports any number of explicitly configured source files and shallow Markdown directories (up to 64 source paths).
- Preserves source order. Within each directory, sorts `*.md` files by filename.
- Re-reads files for every relevant model request, so edits take effect without restarting OpenCode.
- Deduplicates repeated files, skips symbolic links and non-Markdown files.
- Enforces per-file and total size limits.
- Does not rewrite user messages or persist merged instructions to disk.
- Reads three scopes: built-in files shipped in `instructions/`, project files from `options.sources`, `.agents/instructions/`, and `.opencode/instructions/`, and global files from `~/.config/opencode/instructions/`.
- Reads only Markdown files and their immediate Markdown children; never recurses.

## Per-file toggles

In an OpenCode Desktop session, click **Instructions** in the session header. The dialog groups files into **Built-in**, **Project**, and **Global** sections. Switch a file **On** or **Off**; changes apply to subsequent model requests, including compaction when `includeCompaction` is enabled. The built-in section also has a master switch that excludes every built-in file at once; it is on by default.

Each row has **Show** for a Markdown preview; project and global rows also have a pencil button that opens the file in the app's file editor. Built-in files ship with the plugin, so they have no pencil. A missing file stays listed so you can spot a misconfigured path.

Files default to enabled. Disabled paths persist in server-side plugin storage under `instruction-toggles`; changing a switch does not edit the source file or `AGENTS.md`. The dialog uses the active session's server and project location, including WSL and remote servers. It does not browse your desktop's filesystem.

The GUI uses the `rozsazoltan.opencode-instructions` RPC: `list` returns files with their scope, existence and enabled state, plus the built-in master flag; `set({ path, enabled })` updates one file; `setBuiltin({ enabled })` updates the master flag; `changed` notifies open dialogs to refresh.

## Install from shared monorepo

After this package is committed to `rozsazoltan/dev/plugins/opencode-instructions`, add its package through the OpenCode V2 plugin manager:

```bash
opencode plugin add 'github:rozsazoltan/dev#master::path:plugins/opencode-instructions'
```

The package is separate from APM's `plugin.json` bundles. **Do not assume `apm install` will install an executable OpenCode V2 server plugin.**

No options are required. The plugin always reads its seven built-in files from `instructions/` in the installed package, then every `*.md` in the project's `.agents/instructions/` and `.opencode/instructions/`, then every `*.md` in `~/.config/opencode/instructions/` (`$XDG_CONFIG_HOME` is honored). Use the **Instructions** dialog to disable individual files. Built-in files resolve from the installed plugin, not your project or working directory.

Use the *object form* in global `~/.config/opencode/opencode.jsonc` to override sources or other options. Explicit `sources` add project-scope files; they do not replace the built-in or default directories. Set `includeBuiltin` or `includeDefaultDirectories` to `false` to drop those scopes. Add this entry to the existing `plugins` array; preserve existing entries:

```jsonc
{
  "plugins": [
    {
      "package": "github:rozsazoltan/dev#master::path:plugins/opencode-instructions",
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

To pin updates, use a full Git commit SHA in place of `master` after validating the package.

## Local development

For a local checkout of `dev` and a *global* `opencode.jsonc`, reference the plugin **directory** by absolute path. For example:

```jsonc
{
  "plugins": [
    {
      "package": "D:/github/rozsazoltan/dev/plugins/opencode-instructions",
      "options": {
        "sources": ["~/.config/opencode/instructions"],
        "exclude": ["draft.md", "old.md"],
        "onMissing": "warn"
      }
    }
  ]
}
```

WSL example path: `/github/rozsazoltan/dev/plugins/opencode-instructions`.

`~` resolves to the current user's home directory on both platforms. Relative instruction paths resolve from the **canonical project checkout**, not from the plugin's package directory and not from the current working directory. Prefer `~` or absolute paths for global instructions.

## Configuration options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sources` | `string[]` | `[]` | Extra project-scope `.md` files or directories; directories contribute their immediate `.md` children. |
| `includeBuiltin` | `boolean` | `true` | Read the built-in files in the package's `instructions/` directory. |
| `includeDefaultDirectories` | `boolean` | `true` | Read the project `.agents/instructions/` and `.opencode/instructions/` directories and the global `~/.config/opencode/instructions/` directory. |
| `exclude` | `string[]` | `[]` | Exact `.md` basenames to skip in configured directories; case-insensitive, no globs. |
| `includeCompaction` | `boolean` | `false` | Also inject same instructions into compaction requests. |
| `onMissing` | `"warn" \| "ignore" \| "error"` | `"warn"` | Missing or skipped source behavior. |
| `maxFileBytes` | `number` | `65536` | Maximum bytes per file (max: 1 MiB). |
| `maxTotalBytes` | `number` | `262144` | Combined maximum bytes (max: 4 MiB). |

Exclusions apply only to immediate files found inside configured directories. Explicit file sources still load even when their basename appears in `exclude`.

One joined system text part is appended through `ctx.session.hook("context", ...)`, and optionally `ctx.session.hook("compaction", ...)`. Other system parts are not modified. Plugin does **not** affect titles or auxiliary generation requests. OpenCode native `AGENTS.md`, project instructions, policies and higher-priority system rules still apply.

## Migrating your current AGENTS.md

To customize the built-in instructions, copy the files you want from `instructions/` into your own source directory:

- `browser-research.md`: browser-based research, authenticated sessions, and human challenge handoff.
- `context-recovery.md`: planning files, durable task state, and recovery after compaction.
- `completion-verification.md`: evidence-based completion checks.

These files load automatically from the package. When you copy them into your own directory, disable the built-in copies in the **Instructions** dialog, or set `includeBuiltin` to `false`.

1. Copy desired text into separate Markdown files under `~/.config/opencode/instructions/` (starter content included in `instructions/`). The plugin reads that directory automatically.
2. Keep current global `AGENTS.md` until plugin loads and instructions work in an OpenCode session.
3. After verification, remove or slim **duplicate** text from global `AGENTS.md`, and remove any duplicated files from OpenCode's built-in `instructions` array.
4. Keep project-level `AGENTS.md` files for project-specific rules. Global plugin supplements, not overrides, those instructions.

The plugin injects configured Markdown as model instructions. Configure **trusted files only**; never include credentials, `.env`, `.secrets`, or untrusted repository material. Source filenames appear inside the model context; absolute paths are not included in the injected text, but configured file contents are sent to the model.

## Development and validation

```bash
cd plugins/opencode-instructions
npm install
npm test
npm run typecheck
npm run build:gui
opencode plugin list
```

Unit tests run under Node.js 22+. Runtime needs the OpenCode version whose API exposes `@opencode/plugin` and `ctx.session.hook("context", ...)` (OpenCode V2).

The GUI export loads `dist/gui-experimental.cjs`; rebuild it after changing GUI source. The generated bundle is included in the package so installation does not require a GUI build.

Keep the script named `build:gui`: a generic `build` script triggers npm Git dependency preparation, which can fail when npm is launched through a compiled OpenCode executable.

Local checks do not verify remote Git-subdirectory loading or live OpenCode Desktop interaction.

## Troubleshooting

- No instructions loaded: check the **Instructions** switches, including the built-in master switch. Confirm paths exist in *the OpenCode server process's filesystem* (important for WSL and remote servers).
- Duplicate instructions: remove matching content from legacy global `AGENTS.md` or built-in `instructions` entries.
- On Windows, use `D:/github/...` absolute plugin paths for local installs; use `/github/...` or `/mnt/d/...` as appropriate within WSL.
- Missing files produce warnings by default; use `onMissing: "error"` when every source is mandatory.
- Plugin fails in OpenCode V1: upgrade/port separately; V1 plugin API is intentionally unsupported here.

## Official docs

- https://opencode.ai/docs/build/plugins
- https://opencode.ai/docs/build/plugins/server
- https://opencode.ai/docs/plugins/
