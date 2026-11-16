import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, isAbsolute, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeAttachment, extensionForMime, existingFilePath, parseDataUrl, sanitizeFileName, type CapturedAttachment } from "./materialize.ts"
import type { AttachmentInfo, AttachmentStatus } from "./rpc.ts"

export interface AttachmentRecord {
  readonly id: string
  readonly sessionID: string
  readonly order: number
  readonly name: string
  readonly uri: string
  readonly mime: string
  readonly bytes: number
  readonly files: string[]
  readonly createdAt?: string
  readonly capturedAt: string
  readonly ownedPath?: string
}

const MAX_SESSIONS = 4
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const ROOT = join(
  process.env.LOCALAPPDATA || (process.platform === "win32" ? join(homedir(), "AppData", "Local") :
    process.platform === "darwin" ? join(homedir(), "Library", "Caches") :
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache")),
  "opencode", "attachments",
)
const sessions = new Map<string, AttachmentRecord[]>()
let counter = 0
const sessionHash = (id: string) => createHash("sha256").update(id).digest("hex")
const sessionDir = (id: string) => join(ROOT, sessionHash(id))
const validSession = (id: string) => typeof id === "string" && id.length > 0 && id.length <= 1024

export function sessionTempDir(sessionID: string): string {
  return join(tmpdir(), "opencode", "attachments", sessionID)
}

async function safeDirectory(path: string): Promise<void> {
  const root = await realRoot()
  const rel = relative(root, path)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Unsafe attachment cache path")
  let current = root
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error
    })
    const entry = await lstat(current)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Unsafe attachment cache path")
  }
}

async function realRoot(): Promise<string> {
  await mkdir(ROOT, { recursive: true, mode: 0o700 })
  const root = await lstat(ROOT)
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("Unsafe attachment cache path")
  return ROOT
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

export async function recordPrompt(
  sessionID: string,
  files: readonly CapturedAttachment[],
  createdAt?: string,
): Promise<void> {
  if (!validSession(sessionID) || files.length === 0) return
  await hydrate(sessionID)
  const records = bucket(sessionID)
  for (const file of files) {
    const order = records.length + 1
    const parsed = parseDataUrl(file.uri)
    const source = existingFilePath(file.uri)
    const mime = parsed?.mime ?? ""
    const name = sanitizeFileName(file.name ?? "") || `attachment-${order}${extensionForMime(mime) ? `.${extensionForMime(mime)}` : ""}`
    const record: AttachmentRecord = {
      id: `attachment-${++counter}-${randomUUID()}`,
      sessionID, order, name, uri: file.uri, mime,
      bytes: 0, files: source ? [source] : [], capturedAt: new Date().toISOString(),
      ...(createdAt ? { createdAt } : {}),
    }
    records.push(record)
    try {
      let bytes: Buffer
      if (parsed) bytes = decodeAttachment(file).bytes
      else if (source) {
        const info = await stat(source)
        if (!info.isFile() || info.size > 25 * 1024 * 1024) continue
        bytes = await readFile(source)
      } else continue
      const directory = join(sessionDir(sessionID), "blobs")
      await safeDirectory(directory)
      const filePath = join(directory, `${randomUUID()}.bin`)
      const temporary = `${filePath}.tmp`
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 })
      await rename(temporary, filePath)
      Object.assign(record, { bytes: bytes.byteLength, ownedPath: filePath })
    } catch {
      // Attachment capture must not block chat submission.
    }
  }
  try { await persist(sessionID) } catch { /* Best-effort durable metadata. */ }
}

async function persist(sessionID: string): Promise<void> {
  const directory = sessionDir(sessionID)
  await safeDirectory(directory)
  const rows = (sessions.get(sessionID) ?? []).map((record) => ({
    id: record.id, order: record.order, name: record.name, mime: record.mime,
    bytes: record.bytes, createdAt: record.createdAt, capturedAt: record.capturedAt, ownedPath: record.ownedPath,
  }))
  const target = join(directory, "records.json")
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(rows), { flag: "wx", mode: 0o600 })
  await rename(temporary, target)
}

async function hydrate(sessionID: string): Promise<void> {
  if (sessions.has(sessionID) || !validSession(sessionID)) return
  const records: AttachmentRecord[] = []
  try {
    const directory = sessionDir(sessionID)
    await safeDirectory(directory)
    const rows = JSON.parse(await readFile(join(directory, "records.json"), "utf8")) as Array<Record<string, unknown>>
    for (const row of rows) {
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.mime !== "string" ||
          typeof row.order !== "number" || typeof row.bytes !== "number" || typeof row.ownedPath !== "string") continue
      const capturedAt = typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt))
        ? row.capturedAt
        : new Date().toISOString()
      const expected = join(directory, "blobs")
      const rel = relative(expected, row.ownedPath)
      if (rel.startsWith("..") || isAbsolute(rel) || !rel || rel.includes("..")) continue
      await safeDirectory(expected)
      const info = await lstat(row.ownedPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 25 * 1024 * 1024) continue
      records.push({
        id: row.id, order: row.order, name: sanitizeFileName(row.name) || "attachment",
        mime: row.mime, bytes: info.size, uri: "", files: [row.ownedPath], ownedPath: row.ownedPath,
        ...(typeof row.createdAt === "string" ? { createdAt: row.createdAt } : {}),
        capturedAt,
        sessionID,
      })
    }
  } catch { /* Missing or malformed cache is an empty session. */ }
  sessions.set(sessionID, records)
}

export async function cleanup(): Promise<void> {
  const cutoff = Date.now() - MAX_AGE
  try {
    await realRoot()
    for (const name of await readdir(ROOT)) {
      const directory = join(ROOT, name)
      try {
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink()) continue
        const metadata = join(directory, "records.json")
        const rows = JSON.parse(await readFile(metadata, "utf8")) as Array<Record<string, unknown>>
        const kept = rows.filter((row) => typeof row.capturedAt !== "string" || !Number.isFinite(Date.parse(row.capturedAt)) || Date.parse(row.capturedAt) >= cutoff)
        const expired = rows.filter((row) => typeof row.capturedAt === "string" && Number.isFinite(Date.parse(row.capturedAt)) && Date.parse(row.capturedAt) < cutoff)
        for (const row of expired) {
          if (typeof row.ownedPath !== "string") continue
          const rel = relative(join(directory, "blobs"), row.ownedPath)
          if (!rel.startsWith("..") && !isAbsolute(rel) && !rel.includes("..")) await rm(row.ownedPath, { force: true })
        }
        if (kept.length !== rows.length) await writeFile(metadata, JSON.stringify(kept), { mode: 0o600 })
        if (kept.length === 0 && expired.length) await rm(join(directory, "blobs"), { recursive: true, force: true })
      } catch { /* Best-effort expiry. */ }
    }
  } catch { /* Cache may not exist. */ }
}

export async function deleteSession(sessionID: string): Promise<void> {
  await clearRecords(sessionID)
}

export async function clearRecords(sessionID?: string): Promise<void> {
  if (sessionID === undefined) {
    sessions.clear()
    return
  }
  sessions.delete(sessionID)
  const directory = sessionDir(sessionID)
  try {
    const rows = JSON.parse(await readFile(join(directory, "records.json"), "utf8")) as Array<Record<string, unknown>>
    for (const row of rows) if (typeof row.ownedPath === "string") {
      const rel = relative(join(directory, "blobs"), row.ownedPath)
      if (!rel.startsWith("..") && !isAbsolute(rel) && !rel.includes("..")) await rm(row.ownedPath, { force: true })
    }
  } catch { /* Best-effort owned-copy cleanup. */ }
  await rm(join(directory, "records.json"), { force: true }).catch(() => {})
  await rm(join(directory, "blobs"), { recursive: true, force: true }).catch(() => {})
}

export async function listRecords(sessionID: string): Promise<readonly AttachmentRecord[]> {
  await cleanup()
  await hydrate(sessionID)
  const result = (sessions.get(sessionID) ?? []).filter(
    (record) => Date.parse(record.capturedAt) >= Date.now() - MAX_AGE,
  )
  sessions.set(sessionID, result)
  for (const record of result) {
    if (record.ownedPath) continue
    const source = existingFilePath(record.uri)
    if (source) {
      try {
        const info = await stat(source)
        if (info.isFile() && info.size <= 25 * 1024 * 1024) Object.assign(record, { bytes: info.size })
      } catch { /* Unreadable source remains visible but unavailable. */ }
    }
  }
  return result
}

export function findRecord(sessionID: string, id: string): AttachmentRecord | undefined {
  return sessions.get(sessionID)?.find((record) => record.id === id)
}

export function recordWrite(record: AttachmentRecord, path: string): void {
  if (!record.files.includes(path)) record.files.push(path)
}

export function fileStatus(sessionID: string, path: string): Exclude<AttachmentStatus, "new"> {
  return path.startsWith(sessionTempDir(sessionID) + "/") ? "temp" : "saved"
}

export function describe(sessionID: string, record: AttachmentRecord): AttachmentInfo {
  const last = record.files[record.files.length - 1]
  return {
    id: record.id, order: record.order, name: record.name, mime: record.mime,
    bytes: record.bytes, status: last ? fileStatus(sessionID, last) : "new",
    files: [...record.files], ...(last ? { path: last } : {}),
    ...(record.createdAt ? { createdAt: record.createdAt } : {}),
  }
}
