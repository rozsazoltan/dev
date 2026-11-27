import { lstat, open, realpath } from "node:fs/promises"
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

  /** A symlinked ancestor could point anywhere, so the real path must stay inside the root too. */
  async function contained(target: string): Promise<string> {
    const real = await realpath(target)
    const rel = relative(base, real)
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path resolves outside the project root")
    return real
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
          await contained(target)
          entries.push({ path, exists: true, kind: "directory" })
          continue
        }
        if (!info.isFile()) {
          entries.push({ path, exists: true, error: "not a regular file" })
          continue
        }
        const real = await contained(target)
        // Read a bounded prefix instead of the whole file, and always close the handle.
        const handle = await open(real, "r")
        try {
          const buffer = Buffer.alloc(Math.min(8192, Number(info.size)))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          const head = buffer.subarray(0, bytesRead).toString("utf8")
          const lead = head.split("\n").find((line) => line.trim() !== "")?.slice(0, 160) ?? ""
          entries.push({ path, exists: true, kind: "file", bytes: info.size, lead })
        } finally {
          await handle.close()
        }
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

/** Minimal shape of the OpenCode vcs domain that the auditor reads. */
export interface VcsLike {
  get(input: { location: { directory: string } }): Promise<{ data: unknown }>
  status(input: { location: { directory: string } }): Promise<{ data: unknown }>
  diff(input: { location: { directory: string }; mode: "working" | "branch" | "committed"; base?: string }): Promise<{ data: unknown }>
}

const clip = (value: unknown, limit: number) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Read-only git view: branch/head info, working tree status, and a bounded diff summary. */
export function createGitEvidence(vcs: VcsLike, directory: string) {
  return {
    async info(): Promise<string> {
      return clip((await vcs.get({ location: { directory } })).data, 800)
    },
    async status(): Promise<string> {
      return clip((await vcs.status({ location: { directory } })).data, 4000)
    },
    async diff(mode: "working" | "branch" | "committed", base?: string): Promise<string> {
      const data = (await vcs.diff({ location: { directory }, mode, ...(base ? { base } : {}) })).data
      return clip(data, 6000)
    },
  }
}
