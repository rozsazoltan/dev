import { statSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Attachments larger than this are rejected instead of being held in memory and written. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AttachmentError"
  }
}

/** One file from the incoming prompt, kept as its raw URI so nothing is decoded until the tool runs. */
export interface CapturedAttachment {
  readonly uri: string
  readonly name?: string
}

export interface DecodedAttachment {
  readonly bytes: Buffer
  readonly mime: string
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "application/gzip": "gz",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/html": "html",
  "application/octet-stream": "bin",
}

export interface ParsedDataUrl {
  readonly mime: string
  readonly base64: boolean
  readonly payload: string
}

export function parseDataUrl(uri: string): ParsedDataUrl | undefined {
  const match = /^data:([^,]*),(.*)$/s.exec(uri)
  if (!match) return undefined
  const [meta, payload] = [match[1], match[2]]
  const segments = meta.split(";")
  const mime = segments[0]?.trim() || "application/octet-stream"
  const base64 = segments.slice(1).some((segment) => segment.trim().toLowerCase() === "base64")
  return { mime, base64, payload }
}

/** Decodes the bytes behind a captured attachment and rejects anything that is not inline data. */
export function decodeAttachment(attachment: CapturedAttachment, maxBytes = MAX_ATTACHMENT_BYTES): DecodedAttachment {
  const parsed = parseDataUrl(attachment.uri)
  if (!parsed) throw new AttachmentError("Attachment is not an inline data: URL, so its bytes are unavailable.")

  const payload = parsed.base64 ? stripWhitespace(parsed.payload) : parsed.payload
  if (parsed.base64 && base64Bytes(payload) > maxBytes) {
    throw new AttachmentError(`Attachment is larger than the ${maxBytes} byte limit. Paste a smaller file.`)
  }

  const bytes = parsed.base64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8")

  if (bytes.byteLength > maxBytes) {
    throw new AttachmentError(
      `Attachment is ${bytes.byteLength} bytes, over the ${maxBytes} byte limit. Paste a smaller file.`,
    )
  }

  return { bytes, mime: parsed.mime }
}

/** TUI `@file` mentions are already real files; return the path instead of copying bytes. */
export function existingFilePath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

export function extensionForMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined
  return MIME_EXTENSIONS[mime.toLowerCase()]
}

export function defaultFileName(mime: string | undefined, index: number, now = Date.now()): string {
  const extension = extensionForMime(mime)
  return `attachment-${index}-${now}${extension ? `.${extension}` : ""}`
}

/** Keeps only the final path segment and strips characters that are invalid or unsafe in a file name. */
export function sanitizeFileName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? ""
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim()
  if (!cleaned || cleaned === "." || cleaned === "..") return ""
  return cleaned
}

export function selectAttachment<T extends CapturedAttachment>(files: readonly T[], selector?: string): T {
  if (files.length === 0) {
    throw new AttachmentError("The current session has no attachments. Paste the file into the chat, then call this tool.")
  }

  const wanted = selector?.trim()
  if (!wanted) {
    if (files.length === 1) return files[0]
    throw new AttachmentError(
      `The current session has ${files.length} attachments. Pass attachment as a 1-based index or file name. Available: ${describeAttachments(files)}`,
    )
  }

  const index = Number(wanted)
  if (Number.isInteger(index) && index >= 1 && index <= files.length) return files[index - 1]

  const named = files.find((file) => file.name === wanted) ?? files.find((file) => file.name?.toLowerCase() === wanted.toLowerCase())
  if (named) return named

  throw new AttachmentError(`No attachment matches "${wanted}". Available: ${describeAttachments(files)}`)
}

function describeAttachments(files: readonly CapturedAttachment[]): string {
  return files.map((file, index) => `${index + 1}: ${file.name || "(unnamed)"}`).join(", ")
}

export interface TargetOptions {
  /** Destination file or directory from the tool call. */
  readonly path?: string
  /** File name override from the tool call. */
  readonly name?: string
  /** Directory that relative paths resolve against. */
  readonly baseDir: string
  /** Directory used when no path is given. */
  readonly defaultDir: string
  readonly fallbackName: string
  readonly home?: string
  /** Injectable for tests; defaults to a filesystem check. */
  readonly isDirectory?: (candidate: string) => boolean
}

export function resolveTarget(options: TargetOptions): string {
  const home = options.home ?? homedir()
  const name = options.name ? sanitizeFileName(options.name) : ""
  if (options.name && !name) throw new AttachmentError(`Invalid file name: ${options.name}`)

  const requested = options.path?.trim()
  if (!requested) return join(options.defaultDir, name || options.fallbackName)

  const expanded = expandHome(requested, home)
  const absolute = isAbsolute(expanded) ? expanded : resolve(options.baseDir, expanded)
  const trailingSeparator = /[\\/]$/.test(expanded)
  const isDirectory = options.isDirectory ?? defaultIsDirectory

  const directory = trailingSeparator || isDirectory(absolute) || !looksLikeFile(absolute)
  if (directory) return join(absolute, name || options.fallbackName)
  return name ? join(dirname(absolute), name) : absolute
}

export async function writeAttachment(
  target: string,
  bytes: Uint8Array,
  options: { readonly overwrite?: boolean } = {},
): Promise<string> {
  const absolute = resolve(target)
  await mkdir(dirname(absolute), { recursive: true })
  try {
    await writeFile(absolute, bytes, { flag: options.overwrite ? "w" : "wx" })
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new AttachmentError(`File already exists: ${absolute}. Pass overwrite: true or pick another path.`)
    }
    throw error
  }
  return absolute
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "")
}

/** Cheap upper bound so an oversized attachment is rejected before its bytes are allocated. */
function base64Bytes(payload: string): number {
  return Math.ceil((payload.length * 3) / 4)
}

function expandHome(target: string, home: string): string {
  if (target === "~") return home
  if (target.startsWith("~/") || target.startsWith("~\\")) return join(home, target.slice(2))
  return target
}

/** A path is treated as a file when its last segment has an extension. */
function looksLikeFile(candidate: string): boolean {
  const leaf = candidate.split(/[\\/]/).pop() ?? ""
  return /\.[^.]+$/.test(leaf)
}

function defaultIsDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST"
}
