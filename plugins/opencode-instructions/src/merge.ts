import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, extname, isAbsolute, join, resolve } from "node:path"

export type MissingPolicy = "warn" | "ignore" | "error"

export interface MergeConfig {
  sources: string[]
  exclude?: string[]
  onMissing: MissingPolicy
  maxFileBytes: number
  maxTotalBytes: number
  includeCompaction: boolean
}

export interface MergeResult {
  text: string
  files: string[]
  warnings: string[]
}

const DEFAULT_FILE_LIMIT = 64 * 1024
const DEFAULT_TOTAL_LIMIT = 256 * 1024
const MAX_FILE_LIMIT = 1024 * 1024
const MAX_TOTAL_LIMIT = 4 * 1024 * 1024
const MAX_SOURCES = 64
const MAX_DIRECTORY_FILES = 128
export const INSTRUCTION_MARKER = "<!-- opencode-instructions:v1 -->"

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive integer at most ${maximum}`)
  }
  return value
}

export function parseOptions(raw: Record<string, unknown>): MergeConfig {
  if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > MAX_SOURCES) {
    throw new Error(`options.sources must contain 1–${MAX_SOURCES} explicit file or directory paths`)
  }
  const sources = raw.sources.map((source, index) => {
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error(`options.sources[${index}] must be a nonempty path string`)
    }
    return source.trim()
  })
  const rawExclude = raw.exclude === undefined ? [] : raw.exclude
  if (!Array.isArray(rawExclude)) {
    throw new Error("options.exclude must be an array of Markdown filenames")
  }
  const exclude = rawExclude.map((filename, index) => {
    if (
      typeof filename !== "string" ||
      filename.length === 0 ||
      !filename.toLowerCase().endsWith(".md") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\0")
    ) {
      throw new Error(`options.exclude[${index}] must be a nonempty .md basename without path separators`)
    }
    return filename.toLowerCase()
  })
  const onMissing = raw.onMissing ?? "warn"
  if (onMissing !== "warn" && onMissing !== "ignore" && onMissing !== "error") {
    throw new Error('options.onMissing must be "warn", "ignore", or "error"')
  }
  if (raw.includeCompaction !== undefined && typeof raw.includeCompaction !== "boolean") {
    throw new Error("options.includeCompaction must be a boolean")
  }
  const maxFileBytes = boundedPositiveInteger(raw.maxFileBytes, DEFAULT_FILE_LIMIT, MAX_FILE_LIMIT, "options.maxFileBytes")
  const maxTotalBytes = boundedPositiveInteger(raw.maxTotalBytes, DEFAULT_TOTAL_LIMIT, MAX_TOTAL_LIMIT, "options.maxTotalBytes")
  if (maxTotalBytes < maxFileBytes) {
    throw new Error("options.maxTotalBytes must be at least options.maxFileBytes")
  }
  return {
    sources,
    exclude,
    onMissing,
    maxFileBytes,
    maxTotalBytes,
    includeCompaction: raw.includeCompaction === true,
  }
}

/** Relative sources resolve from canonical project checkout, never process.cwd(). */
export function resolveSourcePath(input: string, projectRoot: string, home = homedir()): string {
  if (input === "~") return home
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return resolve(home, input.slice(2))
  }
  return isAbsolute(input) ? resolve(input) : resolve(projectRoot, input)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code)
  }
  return undefined
}

/** Collect only explicit Markdown sources. Directory scans are shallow and alphabetical. */
export async function mergeInstructions(config: MergeConfig, projectRoot: string): Promise<MergeResult> {
  const warnings: string[] = []
  const files: string[] = []
  const blocks: string[] = []
  const visited = new Set<string>()
  const excluded = new Set((config.exclude ?? []).map((filename) => filename.toLowerCase()))
  let totalBytes = 0

  const report = (message: string): void => {
    if (config.onMissing === "error") throw new Error(message)
    if (config.onMissing === "warn") warnings.push(message)
  }

  async function loadFile(path: string): Promise<void> {
    if (extname(path).toLowerCase() !== ".md") {
      report(`Ignoring non-Markdown file: ${path}`)
      return
    }
    try {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        report(`Ignoring non-regular or symlinked file: ${path}`)
        return
      }
      const canonical = await realpath(path)
      const key = process.platform === "win32" ? canonical.toLowerCase() : canonical
      if (visited.has(key)) return
      visited.add(key)
      if (metadata.size > config.maxFileBytes) {
        report(`Markdown source exceeds maxFileBytes: ${path}`)
        return
      }
      if (totalBytes + metadata.size > config.maxTotalBytes) {
        report(`Combined sources exceed maxTotalBytes: ${path}`)
        return
      }
      const buffer = await readFile(path)
      // Guard against file growth between lstat and readFile.
      if (buffer.byteLength > config.maxFileBytes || totalBytes + buffer.byteLength > config.maxTotalBytes) {
        report(`Markdown source exceeds configured size limit: ${path}`)
        return
      }
      if (buffer.includes(0)) {
        report(`Ignoring binary-like Markdown source: ${path}`)
        return
      }
      const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "").trim()
      if (!content) return
      totalBytes += buffer.byteLength
      files.push(canonical)
      blocks.push(`### Source ${files.length}: ${basename(path)}\n\n${content}`)
    } catch (error) {
      if (errorCode(error) === "ENOENT") report(`Missing source file: ${path}`)
      else if (config.onMissing === "error") throw error
      else report(`Could not read source file ${path}: ${String(error)}`)
    }
  }

  for (const input of config.sources) {
    const path = resolveSourcePath(input, projectRoot)
    let metadata
    try {
      metadata = await lstat(path)
    } catch (error) {
      if (errorCode(error) === "ENOENT") report(`Missing source: ${path}`)
      else if (config.onMissing === "error") throw error
      else report(`Could not access source ${path}: ${String(error)}`)
      continue
    }
    if (metadata.isSymbolicLink()) {
      report(`Ignoring symlinked source: ${path}`)
      continue
    }
    if (metadata.isFile()) {
      await loadFile(path)
      continue
    }
    if (!metadata.isDirectory()) {
      report(`Ignoring unsupported source: ${path}`)
      continue
    }
    let entries
    try {
      entries = (await readdir(path, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !excluded.has(entry.name.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
    } catch (error) {
      if (config.onMissing === "error") throw error
      report(`Could not list source directory ${path}: ${String(error)}`)
      continue
    }
    if (entries.length > MAX_DIRECTORY_FILES) {
      report(`Source directory has more than ${MAX_DIRECTORY_FILES} Markdown files: ${path}`)
      continue
    }
    for (const entry of entries) await loadFile(join(path, entry.name))
  }

  if (blocks.length === 0) return { text: "", files, warnings }
  return {
    text: [INSTRUCTION_MARKER, "# Combined user instructions", "", ...blocks].join("\n\n"),
    files,
    warnings,
  }
}
