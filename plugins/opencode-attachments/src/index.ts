import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { Plugin } from "@opencode/plugin"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import {
  AttachmentError,
  decodeAttachment,
  defaultFileName,
  existingFilePath,
  resolveTarget,
  sanitizeFileName,
  selectAttachment,
  writeAttachment,
} from "./materialize.ts"
import {
  clearRecords,
  cleanup,
  deleteSession,
  describe,
  fileStatus,
  findRecord,
  listRecords,
  recordPrompt,
  recordWrite,
  sessionTempDir,
  type AttachmentRecord,
} from "./registry.ts"
import { MAX_ATTACHMENT_BYTES } from "./materialize.ts"
import { Attachments, type ListRequest, type PreviewRequest, type SaveRequest } from "./rpc.ts"

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

/** Bytes behind a record: inline data for pastes, the file itself for a TUI `@file` mention. */
async function bytesOf(record: AttachmentRecord): Promise<Buffer> {
  if (record.ownedPath) return readFile(record.ownedPath)
  const existing = existingFilePath(record.uri)
  if (existing) return readFile(existing)
  return decodeAttachment(record).bytes
}

/** OpenCode V2 server plugin: captures prompt attachments, writes them on demand, and serves both UI halves. */
export default Plugin.define({
  id: "opencode-attachments",
  async setup(ctx) {
    const rpc = await ctx.rpc.register(Attachments, {
      list: async (raw) => {
        const request = raw as ListRequest
        return {
          attachments: (await listRecords(request.sessionID)).map((record) => describe(request.sessionID, record)),
          directory: sessionTempDir(request.sessionID),
        }
      },
      preview: async (raw) => {
        const request = raw as PreviewRequest
        const record = findRecord(request.sessionID, request.id)
        if (!record) throw new Error("Attachment is no longer in memory. Paste it into the chat again.")
        const mime = record.mime
        if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
          throw new Error(`Attachment cannot be previewed: ${mime}`)
        }
        const bytes = await bytesOf(record)
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds the 25 MiB preview limit.")
        return { mime, base64: bytes.toString("base64") }
      },
      save: async (raw) => {
        const request = raw as SaveRequest
        const record = findRecord(request.sessionID, request.id)
        if (!record) throw new Error("Attachment is no longer in memory. Paste it into the chat again.")
        if (!isAbsolute(request.directory)) throw new Error(`Destination must be an absolute directory: ${request.directory}`)

        const name = sanitizeFileName(request.name ?? "") || record.name
        const target = join(request.directory, name)
        const written = await writeAttachment(target, await bytesOf(record), {
          overwrite: request.overwrite === true,
        })
        recordWrite(record, written)
        await rpc.events.emit("changed", { sessionID: request.sessionID })
        return { path: written, status: fileStatus(request.sessionID, written) }
      },
      clear: async (raw) => {
        const request = raw as ListRequest
        await clearRecords(request.sessionID)
        await rpc.events.emit("changed", { sessionID: request.sessionID })
        return null
      },
    })

    await cleanup()
    const deletions = ctx.event
      ? Effect.runFork(
          Stream.runForEach(
            Stream.fromAsyncIterable(ctx.event.subscribe({ types: ["session.deleted"] }), (error) => error),
            (event) =>
              Effect.promise(() => deleteSession(event.data.sessionID)).pipe(
                Effect.catchCause(() => Effect.void),
              ),
            ),
        )
      : undefined
    await ctx.session.hook("prompt", async (event) => {
      const files = event.prompt.files ?? []
      if (files.length === 0) return
      let createdAt: string | undefined
      try {
        const messages = await ctx.session.context({ sessionID: event.sessionID })
        const created = messages.find((message) => message.id === event.messageID)?.time.created
        if (created !== undefined) createdAt = new Date(created).toISOString()
      } catch {
        // Timestamp lookup must not prevent attachment capture.
      }
      try {
        await recordPrompt(
          event.sessionID,
          files.map((file) => ({ uri: file.uri, name: file.name })),
          createdAt,
        )
        await rpc.events.emit("changed", { sessionID: event.sessionID })
      } catch {
        // Prompt capture must not block chat submission.
      }
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "attachment_to_file",
        description: [
          "Write one attachment from the latest chat message to a file on disk.",
          "Readable attachments are copied automatically to the private host cache and retained best-effort for seven days; unreadable media: references are skipped.",
          "Without path, the file goes to a per-session OpenCode temp directory.",
          "Existing files are not replaced unless overwrite is true.",
        ].join(" "),
        input,
        async execute(raw, context) {
          const request = raw as ToolInput
          const records = await listRecords(context.sessionID)
          try {
            const record = selectAttachment(records, request.attachment)

            const alreadyOnDisk = existingFilePath(record.uri)
            if (alreadyOnDisk) {
              recordWrite(record, alreadyOnDisk)
              await rpc.events.emit("changed", { sessionID: context.sessionID })
              return {
                content: `Attachment is already a file: ${alreadyOnDisk}`,
                metadata: { path: alreadyOnDisk, existing: true },
              }
            }

            const decoded = decodeAttachment(record)
            const fallbackName = sanitizeFileName(record.name) || defaultFileName(decoded.mime, record.order)
            const target = resolveTarget({
              path: request.path,
              name: request.name,
              baseDir: ctx.location.project.canonical || ctx.location.directory,
              defaultDir: sessionTempDir(context.sessionID),
              fallbackName,
            })

            const written = await writeAttachment(target, decoded.bytes, { overwrite: request.overwrite === true })
            recordWrite(record, written)
            await rpc.events.emit("changed", { sessionID: context.sessionID })
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
      if (deletions) void Effect.runPromise(Fiber.interrupt(deletions)).catch(() => {})
      void clearRecords()
    }
  },
})
