/** Types shared by the audit engine, the Hindsight client and the plugin tools. */

export interface MemoryUnit {
  id: string
  text: string
  type?: string
  context?: string
  fact_type?: string
  document_id?: string | null
  state?: string
  date?: string
  mentioned_at?: string
  updated_at?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  source_memory_ids?: string[]
  invalidation_reason?: string | null
  history?: unknown[]
  source_memories?: unknown[]
  observation_scopes?: unknown[]
}

export interface Inventory {
  bank: string
  scanned: number
  valid: number
  invalidated: number
  truncated: boolean
  revision: string
  changed: boolean
  missingIds: string[]
  complete: boolean
  warnings: string[]
  memories: MemoryUnit[]
}

export type FindingState = "DUPLICATE" | "LOW_SIGNAL" | "CONTRADICTORY" | "UNVERIFIED" | "STALE_DERIVED"

export interface Finding {
  id: string
  state: FindingState
  severity: "low" | "medium" | "high"
  memoryIds: string[]
  /** The memory that stays when the finding is applied; the rest are retired. */
  keep?: string
  detail: string
  evidence?: string
}

export type OperationKind = "invalidate" | "restore" | "merge" | "edit"

export interface OperationSource {
  id: string
  text: string
  context?: string
  fact_type?: string
  state?: string
  tags?: string[]
  date?: string
  provenance?: unknown
  snapshot?: MemoryUnit
}

export interface Operation {
  id: string
  kind: OperationKind
  /** Target memory for `invalidate`, `restore` and `edit`; the first source for `merge`. */
  memoryId: string
  reason: string
  /** Text of the target at plan time, to detect a changed target before applying. */
  before: string
  /** Duplicate retirement: the memory that must stay valid and unchanged. */
  keep?: string
  keepBefore?: string
  /** `merge`: every source that must still be valid and unchanged, and the text to retain. */
  sources?: OperationSource[]
  text?: string
  context?: string
  documentId?: string
  beforeSnapshot?: MemoryUnit
  keeperSnapshot?: MemoryUnit
}

export interface Plan {
  id: string
  hash: string
  bank: string
  createdAt: string
  findings: Finding[]
  operations: Operation[]
}

export interface OperationResult {
  operationId: string
  memoryId: string
  status: "applied" | "skipped" | "failed" | "unverified"
  detail: string
}

export interface ApplyReport {
  planId: string
  bank: string
  results: OperationResult[]
}

export interface AuditorConfig {
  apiUrl: string
  bank: string
  token?: string
  pageSize: number
  maxMemories: number
  requestTimeoutMs: number
}
