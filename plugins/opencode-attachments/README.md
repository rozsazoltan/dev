# OpenCode Attachments

OpenCode V2 server plugin that lets the agent turn a chat attachment into a real file at a path and name **it chooses**, and only when it decides a file is needed.

- Pasting a file into the chat never writes anything to disk.
- The plugin keeps the attachment bytes in memory for the current session and exposes one tool, `attachment_to_file`.
- The tool writes the decoded bytes to any absolute or project-relative path, creating parent directories.
- Without a `path`, the file goes to a per-session OpenCode temp directory: `<os tmpdir>/opencode/attachments/<sessionID>/`.
- Existing files are never replaced unless the call sets `overwrite: true`.
- `@file` mentions that are already real files return their existing path instead of being copied.

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

## Behavior and limits

- Attachment bytes are captured in `ctx.session.hook("prompt", ...)` and held **in memory** for up to four sessions; nothing is decoded or written until the tool runs.
- Only inline `data:` URLs can be written. Stored `media:` references are not readable from the plugin context and produce a clear error.
- Attachments above 25 MiB are rejected rather than written.
- A tool call in a **subagent** session does not see attachments from the parent session, because each session keeps its own list.
- File names are reduced to their last segment and stripped of path separators and characters that are invalid on Windows, so a crafted attachment name cannot escape the target directory.
- The plugin has no options.

## Development and validation

```bash
cd plugins/opencode-attachments
npm install
npm test
npm run typecheck
opencode plugin list
```

**Validation status:** `npm install --ignore-scripts`, 15 unit tests, and TypeScript typecheck pass locally. Remote Git subdirectory loading and live OpenCode integration remain unverified.

## Troubleshooting

- "The current session has no attachments": paste the file into the chat again, then call the tool in the same session.
- "Attachment is not an inline data: URL": the attachment was already stored as a media reference; re-attach it as a file.
- "File already exists": pass `overwrite: true` or choose another path.
- Plugin fails in OpenCode V1: upgrade/port separately; the V1 plugin API is intentionally unsupported here.

## Official docs

- https://opencode.ai/docs/build/plugins
- https://opencode.ai/docs/build/plugins/server
- https://opencode.ai/docs/plugins/
