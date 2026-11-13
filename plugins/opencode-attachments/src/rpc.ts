import { Rpc } from "@opencode/plugin/rpc"

/** Where an attachment's bytes are: not written yet, in the session temp directory, or at a chosen path. */
export type AttachmentStatus = "new" | "temp" | "saved"

/** One attachment as the TUI and GUI halves see it. Mirrored by the JSON Schema below. */
export interface AttachmentInfo {
  readonly id: string
  /** 1-based position in the conversation, oldest first. */
  readonly order: number
  readonly name: string
  readonly mime: string
  readonly bytes: number
  readonly status: AttachmentStatus
  /** The file written last, when any. */
  readonly path?: string
  /** Every file written from this attachment, oldest first. */
  readonly files: readonly string[]
}

export interface AttachmentList {
  readonly attachments: readonly AttachmentInfo[]
  /** The directory used when the user does not pick another one. */
  readonly directory: string
}

export interface ListRequest {
  readonly sessionID: string
}

export interface SaveRequest {
  readonly sessionID: string
  readonly id: string
  /** Absolute destination directory. */
  readonly directory: string
  /** File name in that directory. */
  readonly name?: string
  readonly overwrite?: boolean
}

export interface SaveResult {
  readonly path: string
  readonly status: Exclude<AttachmentStatus, "new">
}

const AttachmentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    order: { type: "integer" },
    name: { type: "string" },
    mime: { type: "string" },
    bytes: { type: "integer" },
    status: { type: "string", enum: ["new", "temp", "saved"] },
    path: { type: "string" },
    files: { type: "array", items: { type: "string" } },
  },
  required: ["id", "order", "name", "mime", "bytes", "status", "files"],
  additionalProperties: false,
} as const

/**
 * The contract both UI halves call. Plain JSON Schema keeps this module free of Effect, because the GUI bundle may
 * only import modules the app already provides.
 */
export const Attachments = Rpc.define({
  id: "opencode-attachments",
  methods: {
    list: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          attachments: { type: "array", items: AttachmentSchema },
          directory: { type: "string" },
        },
        required: ["attachments", "directory"],
        additionalProperties: false,
      },
    },
    save: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          id: { type: "string" },
          directory: { type: "string", description: "Absolute destination directory." },
          name: { type: "string", description: "File name in that directory." },
          overwrite: { type: "boolean" },
        },
        required: ["sessionID", "id", "directory"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          path: { type: "string" },
          status: { type: "string", enum: ["temp", "saved"] },
        },
        required: ["path", "status"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
  },
})
