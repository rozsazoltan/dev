import { lstat, readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

export interface EvidenceEntry {
  path: string
  exists: boolean
  kind?: "file" | "directory"
  bytes?: number
  /** First line or heading of the file, so the agent can recognise the content cheaply. */
  lead?: string
  error?: string
}

const MAX_BYTES = 128 * 1024

/**
 * Read-only repository access for the auditor. Paths stay inside the project root, symlinks are
 * reported rather than followed, and nothing is ever written.
 */
export function createEvidence(root: string) {
  const base = resolve(root)

  function inside(path: string): string {
    const target = resolve(base, path)
    const rel = relative(base, target)
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path escapes the project root: ${path}`)
    return target
  }

  async function inspect(paths: readonly string[]): Promise<EvidenceEntry[]> {
    const entries: EvidenceEntry[] = []
    for (const path of paths.slice(0, 32)) {
      try {
        const target = inside(path)
        const info = await lstat(target)
        if (info.isSymbolicLink()) {
          entries.push({ path, exists: true, kind: "file", error: "symlink; not followed" })
          continue
        }
        if (info.isDirectory()) {
          entries.push({ path, exists: true, kind: "directory" })
          continue
        }
        const head = (await readFile(target)).subarray(0, 8192).toString("utf8")
        const lead = head.split("\n").find((line) => line.trim() !== "")?.slice(0, 160) ?? ""
        entries.push({ path, exists: true, kind: "file", bytes: info.size, lead })
      } catch (error) {
        const code = (error as { code?: string }).code
        entries.push({
          path,
          exists: code !== "ENOENT",
          error: code === "ENOENT" ? "missing" : error instanceof Error ? error.message : String(error),
        })
      }
    }
    return entries
  }

  return { inspect, maxBytes: MAX_BYTES }
}

export type Evidence = ReturnType<typeof createEvidence>

/** Renders evidence for a tool result, keeping the transcript compact. */
export function formatEvidence(entries: readonly EvidenceEntry[], root: string): string {
  const base = root.split(sep).join("/")
  return entries
    .map((entry) => {
      const head = `- ${entry.path}: ${entry.exists ? (entry.kind ?? "file") : "missing"}`
      const size = entry.bytes === undefined ? "" : ` (${entry.bytes} bytes)`
      const note = entry.error ? ` — ${entry.error}` : ""
      const lead = entry.lead ? `\n    ${entry.lead}` : ""
      return `${head}${size}${note}${lead}`
    })
    .concat(`root: ${base}`)
    .join("\n")
}
