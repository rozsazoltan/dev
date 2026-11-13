# OpenCode Attachments

OpenCode V2 plugin that lets the agent turn a chat attachment into a real file at a path and name **it chooses**, and only when it decides a file is needed — plus a TUI sidebar list and a desktop header button to browse the conversation's attachments and save any of them by hand.

- Pasting a file into the chat never writes anything to disk.
- The plugin keeps the attachment bytes in memory for the current session and exposes one tool, `attachment_to_file`.
- The tool writes the decoded bytes to any absolute or project-relative path, creating parent directories.
- Without a `path`, the file goes to a per-session OpenCode temp directory: `<os tmpdir>/opencode/attachments/<sessionID>/`.
- Existing files are never replaced unless the call sets `overwrite: true`.
- `@file` mentions that are already real files return their existing path instead of being copied.
- Both UI halves list the attachments oldest first with their name, size, and whether they are still unwritten, temp, or saved, and where.

## Requirements

- OpenCode V2 server plugin API (`@opencode/plugin` 2.2.7). The V1 plugin API is intentionally unsupported.
- Node.js 22+ for local tests.

## Install from shared monorepo

After this package is committed to `rozsazoltan/dev/plugins/opencode-attachments`, add its package through the OpenCode V2 plugin manager:

```bash
opencode plugin add 'github:rozsazoltan/dev#master::path:plugins/opencode-attachments'
```

The package is separate from APM's `plugin.json` bundles. **Do not assume `apm install` will install an executable OpenCode V2 server plugin.**

Or add it to the `plugins` array of global `~/.config/opencode/opencode.jsonc`, preserving existing entries:

```jsonc
{
  "plugins": [
    {
      "package": "github:rozsazoltan/dev#master::path:plugins/opencode-attachments"
    }
  ]
}
```

A full example appears in `examples/opencode.global.jsonc`. To pin updates, use a full Git commit SHA in place of `master` after validating the package.

## Local development

For a local checkout and a *global* `opencode.jsonc`, reference the plugin **directory** by absolute path:

```jsonc
{
  "plugins": [
    {
      "package": "D:/github/rozsazoltan/dev/plugins/opencode-attachments"
    }
  ]
}
```

WSL example path: `/github/rozsazoltan/dev/plugins/opencode-attachments`.

## Tool: `attachment_to_file`

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `attachment` | `string` | the only attachment | 1-based index or file name from the latest message that carried attachments. |
| `path` | `string` | session temp directory | Destination file or directory. Absolute, `~`, or project-relative. A trailing separator, an existing directory, or a last segment without an extension means "put the file in here". |
| `name` | `string` | attachment name, else `attachment-<index>-<timestamp>.<ext>` | File name override. Appended to a directory path, or replaces the last segment of a file path. |
| `overwrite` | `boolean` | `false` | Replace an existing file. |

The result is the absolute path, MIME type, and byte count, for example:

```text
Wrote /srv/www/assets/hero.webp (image/webp, 184320 bytes)
```

Typical use: the agent pastes an image into the chat, then calls `attachment_to_file` with the path where the site expects the background image. No manual copy step is needed.

## Terminal half

The package ships a TUI part as `./tui`, built from `src/tui.tsx` into `dist/tui.js`.

- The session sidebar gets an **Attachments** block: the last six attachments of the open conversation, oldest last, each with its 1-based position, name, status (`not written`, `temp`, `saved`), size, and the path when one exists.
- Clicking a row asks for a **full destination path**, prefilled with the temp path or the last written file. Enter writes it; an existing file asks for confirmation before it is replaced.
- `/attachments` (palette entry **Attachments of this conversation**) lists every attachment of the session in a picker with the same columns, then opens the same save prompt. A terminal has no native file picker, so the path is typed.

## Desktop half

The package ships a GUI part as `./gui-experimental`, built from `src/gui.tsx` into `dist/gui-experimental.cjs`. This half rides on the experimental desktop API and can break on an app update.

- A **Files N** button in the session header opens the attachment list, oldest first.
- **Save as…** opens the system folder picker, then asks for the file name, and the server part writes the bytes. The overwrite confirmation appears when the target exists.
- **Show in folder** reveals the written file in the file manager, and **Copy path** copies it. Both are hidden until a file exists; the folder picker needs the desktop app.

## Behavior and limits

- Attachment bytes are captured in `ctx.session.hook("prompt", ...)` and held **in memory** for up to four sessions; nothing is decoded or written until the tool runs or a UI half saves one.
- The attachment history (names, order, written paths, status) is **memory only**: it disappears when the server process restarts, and a restart drops the bytes too. A file already written stays on disk and can be found there, but it is no longer listed.
- Only inline `data:` URLs can be written. Stored `media:` references are not readable from the plugin context and produce a clear error.
- Attachments above 25 MiB are rejected rather than written.
- A tool call in a **subagent** session does not see attachments from the parent session, because each session keeps its own list.
- File names are reduced to their last segment and stripped of path separators and characters that are invalid on Windows, so a crafted attachment name cannot escape the target directory.
- The plugin has no options.

## Development and validation

```bash
cd plugins/opencode-attachments
npm install
npm run build
npm test
npm run typecheck
opencode plugin list
```

`npm run build` writes the two UI bundles the host loads: `dist/gui-experimental.cjs` and `dist/tui.js`. Commit them with the source, because `./tui` and `./gui-experimental` point at the built files.

### Local development mode

This repository loads the plugin from its own checkout, so a change can be tried before it is published or merged. The repository root has `.opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["../plugins/opencode-attachments"]
}
```

A path in `plugins` resolves against the config file's directory, so `../plugins/opencode-attachments` is this repository's `plugins/` folder. OpenCode reads the package `exports` and loads the server, RPC, terminal, and desktop parts from it. Prefix a package name with `-` to disable an installed copy while the local one is active, as in `["-@rozsazoltan/opencode-attachments", "../plugins/opencode-attachments"]`.

- Run `npm run build` after a TUI or desktop source change, because both halves load the built bundles.
- The server part and `attachment_to_file` appear on the next reload of the server. The sidebar block, `/attachments`, and the desktop header button appear when the terminal or desktop window reloads.
- The local package needs its own `npm install` once; the host resolves `@opencode/plugin`, `@opentui/*`, and `solid-js` from the app, and the package declares the last two as peer dependencies for that reason.

**Validation status:** `npm install --ignore-scripts`, 20 unit tests, TypeScript typecheck, and both bundle builds pass locally. Remote Git subdirectory loading and live OpenCode desktop/terminal integration remain unverified.

## Troubleshooting

- "The current session has no attachments": paste the file into the chat again, then call the tool in the same session.
- "Attachment is not an inline data: URL": the attachment was already stored as a media reference; re-attach it as a file.
- "File already exists": pass `overwrite: true` or choose another path.
- Plugin fails in OpenCode V1: upgrade/port separately; the V1 plugin API is intentionally unsupported here.

## Official docs

- https://opencode.ai/docs/build/plugins
- https://opencode.ai/docs/build/plugins/server
- https://opencode.ai/docs/plugins/
