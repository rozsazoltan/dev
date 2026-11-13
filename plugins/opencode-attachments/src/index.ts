import { tmpdir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import {
  AttachmentError,
  decodeAttachment,
  defaultFileName,
  existingFilePath,
  resolveTarget,
  sanitizeFileName,
  selectAttachment,
  writeAttachment,
  type CapturedAttachment,
} from "./materialize.ts"

/** Latest attached files per session, kept only in memory: nothing touches the disk until the tool runs. */
const MAX_SESSIONS = 4
const sessions = new Map<string, readonly CapturedAttachment[]>()

function remember(sessionID: string, files: readonly CapturedAttachment[]): void {
  sessions.delete(sessionID)
  sessions.set(sessionID, files)
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) return
    sessions.delete(oldest)
  }
}

const input = {
  type: "object",
  properties: {
    attachment: {
      type: "string",
      description: "1-based index or file name of the attachment to write. Defaults to the only attachment.",
    },
    path: {
      type: "string",
      description:
        "Destination file or directory. Absolute paths and ~ are supported; relative paths resolve against the project root. Defaults to the session temp directory.",
    },
    name: {
      type: "string",
      description: "File name to use. Overrides the attachment name and the last segment of path.",
    },
    overwrite: {
      type: "boolean",
      description: "Replace an existing file. Defaults to false.",
    },
  },
  additionalProperties: false,
} as const

interface ToolInput {
  readonly attachment?: string
  readonly path?: string
  readonly name?: string
  readonly overwrite?: boolean
}

/** OpenCode V2 server plugin: captures prompt attachments and exposes one on-demand write tool. */
export default Plugin.define({
  id: "rozsazoltan.opencode-attachments",
  async setup(ctx) {
    await ctx.session.hook("prompt", (event) => {
      const files = event.prompt.files ?? []
      if (files.length === 0) return
      remember(
        event.sessionID,
        files.map((file) => ({ uri: file.uri, name: file.name })),
      )
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "attachment_to_file",
        description: [
          "Write one attachment from the latest chat message to a file on disk.",
          "Attachments are never saved automatically, so call this only when the bytes are needed as a real file.",
          "Without path, the file goes to a per-session OpenCode temp directory.",
          "Existing files are not replaced unless overwrite is true.",
        ].join(" "),
        input,
        async execute(raw, context) {
          const request = raw as ToolInput
          const files = sessions.get(context.sessionID) ?? []
          try {
            const selected = selectAttachment(files, request.attachment)

            const alreadyOnDisk = existingFilePath(selected.uri)
            if (alreadyOnDisk) {
              return {
                content: `Attachment is already a file: ${alreadyOnDisk}`,
                metadata: { path: alreadyOnDisk, existing: true },
              }
            }

            const decoded = decodeAttachment(selected)
            const index = files.indexOf(selected) + 1
            const fallbackName = sanitizeFileName(selected.name ?? "") || defaultFileName(decoded.mime, index)
            const target = resolveTarget({
              path: request.path,
              name: request.name,
              baseDir: ctx.location.project.canonical || ctx.location.directory,
              defaultDir: join(tmpdir(), "opencode", "attachments", context.sessionID),
              fallbackName,
            })

            const written = await writeAttachment(target, decoded.bytes, { overwrite: request.overwrite === true })
            return {
              content: `Wrote ${written} (${decoded.mime}, ${decoded.bytes.byteLength} bytes)`,
              metadata: { path: written, mime: decoded.mime, bytes: decoded.bytes.byteLength },
            }
          } catch (error) {
            if (error instanceof AttachmentError) throw new Error(error.message)
            throw error
          }
        },
      })
    })

    return () => {
      sessions.clear()
    }
  },
})
