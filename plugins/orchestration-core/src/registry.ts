import type { HindsightClient } from "./hindsight.ts"
import type { StateStore, SessionState } from "./state.ts"
import type { Requirement, RequestRecord, RequestStatus, StatusEvent } from "./types.ts"
import { REQUEST_STATUSES } from "./types.ts"

export const REGISTRY_TAG = "type:user-prompt"
export const REGISTRY_SCOPE_TAG = "orchestration:registry"
const TERMINAL: ReadonlySet<RequestStatus> = new Set(["completed", "cancelled", "superseded", "not_applicable"])

const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: "github-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "aws-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "api-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: "credential", pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"',;]{6,}/gi },
]

/** Removes obvious secrets before a prompt leaves the process; the redaction kinds are recorded. */
export function redact(text: string): { text: string; redactions: string[] } {
  let output = text
  const kinds = new Set<string>()
  for (const { kind, pattern } of SECRET_PATTERNS) {
    output = output.replace(pattern, () => {
      kinds.add(kind)
      return `[REDACTED:${kind}]`
    })
  }
  return { text: output, redactions: [...kinds].sort() }
}

/** Our own synthetic injections must never be registered as user prompts. */
export function isSyntheticPrompt(text: string, metadata?: Record<string, unknown>): boolean {
  if (metadata?.synthetic === true || metadata?.orchestration === "synthetic") return true
  return /^(?:\[Hindsight memory\]|Context budget:|Orchestration (?:notice|status):)/.test(text.trimStart())
}

export function documentID(sessionID: string, messageID: string): string {
  return `user-prompt:${safePart(sessionID)}:${safePart(messageID)}`
}

function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "unknown"
}

export function requirementStatus(requirements: Requirement[]): RequestStatus {
  if (requirements.length === 0) return "pending"
  const statuses = requirements.map((requirement) => requirement.status)
  if (statuses.every((status) => status === "completed")) return "completed"
  if (statuses.every((status) => status === "cancelled")) return "cancelled"
  if (statuses.every((status) => status === "not_applicable")) return "not_applicable"
  if (statuses.some((status) => status === "failed")) return "failed"
  if (statuses.some((status) => status === "blocked")) return "blocked"
  if (statuses.some((status) => status === "awaiting_verification")) return "awaiting_verification"
  if (statuses.some((status) => status === "in_progress")) return "in_progress"
  if (statuses.some((status) => status === "completed")) return "partially_completed"
  return "pending"
}

export interface TransitionInput {
  status?: RequestStatus
  note: string
  evidence?: string[]
  replacementID?: string
  userWithdrawal?: boolean
  reopen?: boolean
}

/** Enforces the brief's transition rules instead of trusting a caller's status string. */
export function assertTransition(from: RequestStatus, input: TransitionInput & { status: RequestStatus }): void {
  if (!REQUEST_STATUSES.includes(input.status)) throw new Error(`Unknown request status: ${input.status}`)
  if (!input.note.trim()) throw new Error("Every status transition needs a rationale note.")
  if (TERMINAL.has(from) && !input.reopen && input.status !== from) {
    throw new Error(`Request is ${from}; reopening requires reopen=true and a rationale.`)
  }
  const needsEvidence = ["completed", "partially_completed", "blocked", "failed", "not_applicable"]
  if (needsEvidence.includes(input.status) && !(input.evidence ?? []).length) {
    throw new Error(`Status ${input.status} requires requirement-level evidence.`)
  }
  if (input.status === "cancelled" && input.userWithdrawal !== true) {
    throw new Error("Cancellation requires explicit user withdrawal.")
  }
  if (input.status === "superseded" && !input.replacementID) {
    throw new Error("Supersession requires the replacing request ID.")
  }
}

export function parseRecord(id: string, text: string | null | undefined): RequestRecord {
  if (!text) throw new Error(`Registry document ${id} has no original text.`)
  const value = JSON.parse(text) as RequestRecord
  if (!value || value.type !== "user-prompt" || value.id !== id || !Array.isArray(value.requirements)) {
    throw new Error(`Registry document ${id} is not a valid user-prompt record.`)
  }
  return value
}

export function tagsFor(record: RequestRecord): string[] {
  return [REGISTRY_TAG, REGISTRY_SCOPE_TAG, `status:${record.status}`]
}

export function metadataFor(record: RequestRecord): Record<string, string> {
  return {
    type: "user-prompt",
    request_id: record.id,
    session_id: record.sessionID,
    message_id: record.messageID,
    status: record.status,
    updated_at: record.updatedAt,
  }
}

export class Registry {
  readonly #client: HindsightClient
  readonly #state: StateStore
  readonly #project: string

  constructor(client: HindsightClient, state: StateStore, project: string) {
    this.#client = client
    this.#state = state
    this.#project = project
  }

  /**
   * Records the prompt before execution. The local journal is written first, so a failed Hindsight
   * write leaves a retryable entry instead of losing the request.
   */
  async capture(input: {
    sessionID: string
    messageID: string
    text: string
    metadata?: Record<string, unknown>
    createdAt?: string
  }): Promise<{ id: string; duplicate: boolean }> {
    const id = documentID(input.sessionID, input.messageID)
    const duplicate = await this.#state.update(input.sessionID, (state) => {
      if (state.captured[input.messageID]) return true
      state.captured[input.messageID] = id
      return false
    })
    if (duplicate) return { id, duplicate: true }
    const clean = redact(input.text)
    const at = input.createdAt ?? new Date().toISOString()
    const record: RequestRecord = {
      id,
      version: 1,
      type: "user-prompt",
      sessionID: input.sessionID,
      messageID: input.messageID,
      project: this.#project,
      bank: this.#client.bank,
      createdAt: at,
      updatedAt: at,
      prompt: clean.text,
      redactions: clean.redactions,
      status: "pending",
      requirements: [{ id: "r1", text: clean.text, status: "pending", history: [{ at, status: "pending", note: "Captured before execution" }] }],
      relatedIDs: [],
      history: [{ at, status: "pending", note: "Captured before execution" }],
    }
    await this.#persist(input.sessionID, record)
    return { id, duplicate: false }
  }

  async get(id: string): Promise<RequestRecord> {
    const document = await this.#client.getDocument(id)
    return parseRecord(id, document?.original_text)
  }

  async list(input: { status?: RequestStatus; limit?: number; offset?: number } = {}): Promise<{ records: RequestRecord[]; unreadable: number }> {
    const page = await this.#client.listDocuments({ tags: [REGISTRY_TAG], limit: input.limit ?? 50, offset: input.offset ?? 0 })
    const records: RequestRecord[] = []
    let unreadable = 0
    for (const summary of page.items ?? []) {
      try {
        const document = summary.id ? await this.#client.getDocument(summary.id) : undefined
        const record = parseRecord(summary.id, document?.original_text)
        if (!input.status || record.status === input.status) records.push(record)
      } catch {
        unreadable += 1
      }
    }
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return { records, unreadable }
  }

  async transition(
    sessionID: string,
    id: string,
    input: TransitionInput & { requirements?: Array<{ id: string; text?: string; status?: RequestStatus; note?: string; evidence?: string[] }> },
  ): Promise<RequestRecord> {
    const record = await this.get(id)
    const at = new Date().toISOString()
    if (input.requirements?.length) {
      for (const patch of input.requirements) {
        const requirement = record.requirements.find((item) => item.id === patch.id)
        if (!requirement) {
          if (!patch.text?.trim()) throw new Error(`New requirement ${patch.id} needs text.`)
          record.requirements.push({ id: patch.id, text: patch.text, status: patch.status ?? "pending", history: [] })
          continue
        }
        if (patch.text) requirement.text = patch.text
        if (patch.status && patch.status !== requirement.status) {
          assertTransition(requirement.status, { status: patch.status, note: patch.note ?? input.note, evidence: patch.evidence ?? input.evidence })
          const event: StatusEvent = { at, status: patch.status, note: patch.note ?? input.note, ...(patch.evidence ? { evidence: patch.evidence } : {}) }
          requirement.status = patch.status
          requirement.history.push(event)
        }
      }
    }
    const derived = requirementStatus(record.requirements)
    const target = input.status ?? derived
    if (target !== record.status) {
      assertTransition(record.status, { ...input, status: target })
      record.status = target
      record.history.push({ at, status: target, note: input.note, ...(input.evidence ? { evidence: input.evidence } : {}) })
    }
    if (input.replacementID && !record.relatedIDs.includes(input.replacementID)) record.relatedIDs.push(input.replacementID)
    record.updatedAt = at
    await this.#persist(sessionID, record)
    return record
  }

  /** Writes the authoritative document, falling back to the outbox journal on failure. */
  async #persist(sessionID: string, record: RequestRecord): Promise<void> {
    const text = JSON.stringify(record, null, 2)
    const tags = tagsFor(record)
    const metadata = metadataFor(record)
    try {
      await this.#client.retainDocument({ documentID: record.id, text, tags, metadata, replace: true })
      await this.#state.update(sessionID, (state) => {
        state.outbox = state.outbox.filter((entry) => entry.documentID !== record.id)
        state.lastRequestID = record.id
      })
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error"
      await this.#state.update(sessionID, (state) => {
        const existing = state.outbox.find((entry) => entry.documentID === record.id)
        if (existing) {
          existing.text = text
          existing.tags = tags
          existing.metadata = metadata
          existing.lastError = message
        } else {
          state.outbox.push({
            id: `outbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            kind: "retain",
            documentID: record.id,
            text,
            tags,
            metadata,
            attempts: 1,
            lastError: message,
            createdAt: new Date().toISOString(),
          })
        }
        state.lastRequestID = record.id
      })
    }
  }
}

export function pendingCount(state: SessionState): number {
  return state.outbox.length
}
