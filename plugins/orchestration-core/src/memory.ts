import { createHash } from "node:crypto"
import type { OrchestrationConfig } from "./config.ts"
import type { HindsightClient } from "./hindsight.ts"
import type { StateStore } from "./state.ts"
import type { RecallHit } from "./types.ts"

export const PROJECT_TAG = "type:project-memory"
export const TEMP_TAG = "type:temporary-memory"
const ORCHESTRATION_TAGS = ["orchestration:registry", PROJECT_TAG, TEMP_TAG]

interface MemoryEnvelope {
  id: string
  version: 1
  type: "project-memory" | "temporary-memory"
  text: string
  createdAt: string
  updatedAt: string
  evidence: string[]
  decision?: string
  requestIDs: string[]
  expiresAt?: string
  verified?: boolean
  promotedFrom?: string
  history: Array<{ at: string; text: string; evidence: string[]; note?: string }>
}

export class MemoryManager {
  readonly #client: HindsightClient
  readonly #config: OrchestrationConfig

  constructor(client: HindsightClient, config: OrchestrationConfig) {
    this.#client = client
    this.#config = config
  }

  /**
   * Durable project knowledge. Retaining requires evidence or an explicit user decision, and a
   * changed fact must name its stable ID so the previous version stays in the record's history.
   */
  async retainProject(input: {
    text: string
    id?: string
    evidence?: string[]
    decision?: string
    requestIDs?: string[]
    replace?: boolean
    context?: string
  }): Promise<{ id: string; replaced: boolean }> {
    const text = input.text.trim()
    if (!text) throw new Error("Project memory needs text.")
    const evidence = (input.evidence ?? []).map((item) => item.trim()).filter(Boolean)
    if (!evidence.length && !input.decision?.trim()) {
      throw new Error("Project memory needs evidence or an explicit user decision; unverified claims stay out of durable memory.")
    }
    const id = projectID(input.id ?? text)
    const existing = await this.#client.getDocument(id)
    if (existing && input.replace !== true) {
      throw new Error(`Project memory ${id} already exists; pass replace=true to update it with history.`)
    }
    const previous = existing ? parseEnvelope(existing.original_text) : undefined
    const at = new Date().toISOString()
    const envelope: MemoryEnvelope = {
      id,
      version: 1,
      type: "project-memory",
      text,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
      evidence,
      decision: input.decision?.trim() || undefined,
      requestIDs: input.requestIDs ?? [],
      history: [
        ...(previous?.history ?? []),
        ...(previous ? [{ at, text: previous.text, evidence: previous.evidence, note: "Replaced" }] : []),
      ],
    }
    await this.#client.retainDocument({
      documentID: id,
      text: JSON.stringify(envelope, null, 2),
      tags: [PROJECT_TAG, "orchestration:memory"],
      metadata: { type: "project-memory", memory_id: id, updated_at: at },
      replace: true,
      context: input.context,
    })
    return { id, replaced: Boolean(previous) }
  }

  async get(id: string): Promise<{ id: string; envelope: MemoryEnvelope }> {
    const document = await this.#client.getDocument(id)
    if (!document) throw new Error(`No memory document ${id}.`)
    return { id, envelope: parseEnvelope(document.original_text, id) }
  }

  /** Recall excludes registry and temporary documents by their stable ID prefixes. */
  async recall(input: { query: string; limit?: number }): Promise<{ hits: RecallHit[]; filtered: number }> {
    const results = await this.#client.recall({ query: input.query, limit: (input.limit ?? 10) * 2 })
    const kept = results.filter((hit) => !isOrchestrationDocument(hit.document_id))
    return { hits: kept.slice(0, input.limit ?? 10), filtered: results.length - kept.length }
  }

  async retainTemporary(input: {
    text: string
    id?: string
    evidence?: string[]
    requestIDs?: string[]
    ttlHours?: number
    verified?: boolean
    context?: string
  }): Promise<{ id: string; expiresAt: string }> {
    if (!this.#config.temporaryMemory) {
      throw new Error("Temporary memory is disabled: enable temporaryMemory only after independent deletion and recall isolation are verified.")
    }
    const text = input.text.trim()
    if (!text) throw new Error("Temporary memory needs text.")
    const ttl = input.ttlHours ?? this.#config.tempTtlHours
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > 48) throw new Error("Temporary TTL must be between 1 and 48 hours.")
    const requested = input.id?.trim()
    const id = requested?.startsWith("temporary:")
      ? requested
      : `temporary:${(requested ?? digest(text).slice(0, 12)).replace(/[^A-Za-z0-9._-]+/g, "-")}`
    const at = new Date()
    const expiresAt = new Date(at.getTime() + ttl * 3_600_000).toISOString()
    const envelope: MemoryEnvelope = {
      id,
      version: 1,
      type: "temporary-memory",
      text,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      evidence: input.evidence ?? [],
      requestIDs: input.requestIDs ?? [],
      expiresAt,
      verified: input.verified === true,
      history: [],
    }
    await this.#client.retainDocument({
      documentID: id,
      text: JSON.stringify(envelope, null, 2),
      tags: [TEMP_TAG, "orchestration:memory"],
      metadata: { type: "temporary-memory", memory_id: id, expires_at: expiresAt, created_at: at.toISOString() },
      replace: true,
      context: input.context,
    })
    return { id, expiresAt }
  }

  /** Promotion writes the durable record, confirms it, and only then removes the temporary source. */
  async promote(input: { id: string }): Promise<{ projectID: string; deletedSource: boolean }> {
    if (!this.#config.temporaryMemory) throw new Error("Temporary memory is disabled.")
    const source = await this.get(input.id)
    if (source.envelope.type !== "temporary-memory") throw new Error("Only temporary documents can be promoted.")
    if (source.envelope.verified !== true) {
      throw new Error("Only verified temporary findings can be promoted; mark the record verified with evidence first.")
    }
    const project = await this.retainProject({
      text: source.envelope.text,
      evidence: source.envelope.evidence,
      requestIDs: source.envelope.requestIDs,
    })
    const durable = await this.#client.getDocument(project.id)
    if (!durable?.original_text) throw new Error("Durable write could not be confirmed; the temporary source was kept.")
    await this.#client.deleteDocument(input.id)
    const stillThere = await this.#client.getDocument(input.id)
    return { projectID: project.id, deletedSource: !stillThere }
  }

  /** Deletes only expired temporary documents. Refuses project and registry documents by ID and tag. */
  async purgeTemporary(input: { dryRun?: boolean; limit?: number } = {}): Promise<{
    scanned: number
    expired: number
    deleted: number
    failed: Array<{ id: string; error: string }>
    skipped: number
    dryRun: boolean
  }> {
    const dryRun = input.dryRun !== false
    if (!dryRun && !this.#config.temporaryCleanup) {
      throw new Error("Deletion is disabled: set temporaryCleanup only after an independent scheduler is running.")
    }
    const page = await this.#client.listDocuments({ tags: [TEMP_TAG], limit: input.limit ?? 200 })
    const now = Date.now()
    let expired = 0
    let deleted = 0
    let skipped = 0
    const failed: Array<{ id: string; error: string }> = []
    for (const summary of page.items ?? []) {
      try {
        const document = await this.#client.getDocument(summary.id)
        if (!document) continue
        const envelope = parseEnvelope(document.original_text, summary.id)
        if (envelope.type !== "temporary-memory") {
          skipped += 1
          continue
        }
        if (!envelope.expiresAt || Date.parse(envelope.expiresAt) > now) continue
        expired += 1
        if (dryRun) continue
        await this.#client.deleteDocument(summary.id)
        const gone = await this.#client.getDocument(summary.id)
        if (gone) throw new Error("Deletion was not confirmed")
        deleted += 1
      } catch (error) {
        failed.push({ id: summary.id, error: error instanceof Error ? error.message.slice(0, 160) : "unknown error" })
      }
    }
    return { scanned: page.items?.length ?? 0, expired, deleted, failed, skipped, dryRun }
  }
}

function projectID(input: string): string {
  const slug = input.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  return `project-memory:${slug || digest(input).slice(0, 12)}`
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function isOrchestrationDocument(documentID?: string | null): boolean {
  if (!documentID) return false
  return documentID.startsWith("user-prompt:") || documentID.startsWith("temporary:") ||
    ORCHESTRATION_TAGS.some((tag) => documentID.includes(tag))
}

export function parseEnvelope(text: string | null | undefined, expectedID?: string): MemoryEnvelope {
  if (!text) throw new Error("Memory document has no original text.")
  const value = JSON.parse(text) as MemoryEnvelope
  if (!value || (value.type !== "project-memory" && value.type !== "temporary-memory") || !Array.isArray(value.evidence)) {
    throw new Error("Memory document is not a valid orchestration memory envelope.")
  }
  if (expectedID && value.id !== expectedID) throw new Error("Memory document ID does not match its envelope.")
  return value
}

export type MemoryStateStore = StateStore
