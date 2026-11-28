/** Records shared by the registry, memory manager, context guard and tools. */

export const REQUEST_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_verification",
  "partially_completed",
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "superseded",
  "not_applicable",
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export interface StatusEvent {
  at: string
  status: RequestStatus
  note?: string
  evidence?: string[]
}

export interface Requirement {
  id: string
  text: string
  status: RequestStatus
  history: StatusEvent[]
}

export interface RequestRecord {
  /** `user-prompt:<session>:<message>`: stable, derived from real runtime identifiers. */
  id: string
  version: 1
  type: "user-prompt"
  sessionID: string
  messageID: string
  project: string
  bank: string
  createdAt: string
  updatedAt: string
  prompt: string
  redactions: string[]
  status: RequestStatus
  requirements: Requirement[]
  relatedIDs: string[]
  history: StatusEvent[]
}

export interface DocumentSummary {
  id: string
  created_at?: string
  updated_at?: string
  content_hash?: string | null
  memory_unit_count?: number
  tags?: string[]
  document_metadata?: Record<string, unknown> | null
  text_length?: number
}

export interface DocumentDetail extends DocumentSummary {
  original_text?: string | null
  retain_params?: Record<string, unknown> | null
}

export interface RecallHit {
  id: string
  text: string
  type?: string | null
  document_id?: string | null
  tags?: string[] | null
  mentioned_at?: string | null
  scores?: { final?: number; semantic?: number | null } | null
}

export interface DelegationRecord {
  id: string
  sessionID: string
  agent: string
  description: string
  writePaths: string[]
  readPaths: string[]
  dependsOn: string[]
  status: "running" | "done" | "failed" | "cancelled"
  createdAt: string
  updatedAt: string
}

export interface OutboxEntry {
  id: string
  kind: "retain"
  documentID: string
  text: string
  tags: string[]
  metadata: Record<string, string>
  attempts: number
  lastError?: string
  createdAt: string
}

export interface ContextReading {
  tokens?: number
  source: "measured" | "estimated"
  anchorAt?: string
  estimatedChars: number
  threshold: "ok" | "soft" | "compress" | "hard"
  detail: string
}
