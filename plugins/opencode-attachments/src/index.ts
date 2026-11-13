import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
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
} from "./materialize.ts"
import {
  clearRecords,
  describe,
  fileStatus,
  findRecord,
  listRecords,
  recordPrompt,
  recordWrite,
  sessionTempDir,
  type AttachmentRecord,
} from "./registry.ts"
import { Attachments, type ListRequest, type SaveRequest } from "./rpc.ts"

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
          attachments: listRecords(request.sessionID).map((record) => describe(request.sessionID, record)),
          directory: sessionTempDir(request.sessionID),
        }
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
    })

    await ctx.session.hook("prompt", (event) => {
      const files = event.prompt.files ?? []
      if (files.length === 0) return
      recordPrompt(
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
          const records = listRecords(context.sessionID)
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
      clearRecords()
    }
  },
})
