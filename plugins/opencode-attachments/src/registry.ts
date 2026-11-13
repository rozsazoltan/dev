import { statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { extensionForMime, parseDataUrl, sanitizeFileName, type CapturedAttachment } from "./materialize.ts"
import type { AttachmentInfo, AttachmentStatus } from "./rpc.ts"

/** One captured attachment plus every file written from it. Held in memory only: the user chose no persistence. */
export interface AttachmentRecord {
  readonly id: string
  readonly sessionID: string
  readonly order: number
  readonly name: string
  readonly uri: string
  readonly mime: string
  readonly bytes: number
  readonly files: string[]
}

/** Old sessions are dropped so a long-running app cannot grow without bound. */
const MAX_SESSIONS = 4
const sessions = new Map<string, AttachmentRecord[]>()
let counter = 0

export function sessionTempDir(sessionID: string): string {
  return join(tmpdir(), "opencode", "attachments", sessionID)
}

function bucket(sessionID: string): AttachmentRecord[] {
  const existing = sessions.get(sessionID)
  if (existing) {
    sessions.delete(sessionID)
    sessions.set(sessionID, existing)
    return existing
  }
  const created: AttachmentRecord[] = []
  sessions.set(sessionID, created)
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return created
}

/** Appends a prompt's attachments in arrival order. Capturing never touches the disk. */
export function recordPrompt(sessionID: string, files: readonly CapturedAttachment[]): void {
  if (files.length === 0) return
  const records = bucket(sessionID)
  for (const file of files) {
    const order = records.length + 1
    const parsed = parseDataUrl(file.uri)
    const existing = existingPath(file.uri)
    const mime = parsed?.mime ?? ""
    const extension = extensionForMime(mime)
    const name = sanitizeFileName(file.name ?? "") || `attachment-${order}${extension ? `.${extension}` : ""}`
    records.push({
      id: `attachment-${++counter}`,
      sessionID,
      order,
      name,
      uri: file.uri,
      mime,
      bytes: parsed ? estimatedBytes(parsed.payload, parsed.base64) : existing ? fileSize(existing) : 0,
      files: existing ? [existing] : [],
    })
  }
}

export function listRecords(sessionID: string): readonly AttachmentRecord[] {
  return sessions.get(sessionID) ?? []
}

export function findRecord(sessionID: string, id: string): AttachmentRecord | undefined {
  return listRecords(sessionID).find((record) => record.id === id)
}

export function recordWrite(record: AttachmentRecord, path: string): void {
  if (!record.files.includes(path)) record.files.push(path)
}

export function fileStatus(sessionID: string, path: string): Exclude<AttachmentStatus, "new"> {
  return isInside(path, sessionTempDir(sessionID)) ? "temp" : "saved"
}

export function describe(sessionID: string, record: AttachmentRecord): AttachmentInfo {
  const last = record.files[record.files.length - 1]
  const status: AttachmentStatus = last ? fileStatus(sessionID, last) : "new"
  return {
    id: record.id,
    order: record.order,
    name: record.name,
    mime: record.mime,
    bytes: record.bytes,
    status,
    files: [...record.files],
    ...(last ? { path: last } : {}),
  }
}

export function clearRecords(): void {
  sessions.clear()
}

function existingPath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Upper bound from the encoded length, so a 25 MiB paste is not decoded just to be listed. */
function estimatedBytes(payload: string, base64: boolean): number {
  if (!base64) return Buffer.byteLength(decodeURIComponentPayload(payload))
  return Math.ceil((payload.replace(/\s+/g, "").length * 3) / 4)
}

function decodeURIComponentPayload(payload: string): string {
  try {
    return decodeURIComponent(payload)
  } catch {
    return payload
  }
}

function isInside(path: string, directory: string): boolean {
  const base = resolve(directory)
  const target = resolve(path)
  return target === base || target.startsWith(base + sep)
}
