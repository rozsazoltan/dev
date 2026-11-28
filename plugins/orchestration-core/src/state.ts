import type { DelegationRecord, OutboxEntry } from "./types.ts"
import type { HindsightClient } from "./hindsight.ts"

export interface StorageLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export interface SessionState {
  captured: Record<string, string>
  outbox: OutboxEntry[]
  delegations: DelegationRecord[]
  context: { anchorTokens?: number; anchorAt?: string; estimatedChars?: number; nudgedAnchor?: string }
  lastRequestID?: string
}

const EMPTY: SessionState = { captured: {}, outbox: [], delegations: [], context: {} }

/** Per-session durable state. Hindsight holds authoritative records; this journal survives write failures. */
export class StateStore {
  readonly #storage: StorageLike
  readonly #prefix: string
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(storage: StorageLike, prefix = "orchestration-core.state") {
    this.#storage = storage
    this.#prefix = prefix
  }

  async read(sessionID: string): Promise<SessionState> {
    const value = await this.#storage.get(this.#key(sessionID))
    if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(EMPTY)
    const state = structuredClone(value as SessionState)
    return {
      captured: state.captured ?? {},
      outbox: state.outbox ?? [],
      delegations: state.delegations ?? [],
      context: state.context ?? {},
      lastRequestID: state.lastRequestID,
    }
  }

  /** Serialized read-modify-write per session, so two hooks cannot clobber each other's state. */
  async update<T>(sessionID: string, change: (state: SessionState) => Promise<T> | T): Promise<T> {
    const previous = this.#queues.get(sessionID) ?? Promise.resolve()
    const next = previous.then(async () => {
      const state = await this.read(sessionID)
      const result = await change(state)
      await this.#storage.set(this.#key(sessionID), state)
      return result
    })
    this.#queues.set(sessionID, next.catch(() => undefined))
    return next
  }

  #key(sessionID: string): string {
    return `${this.#prefix}.${sessionID}`
  }
}

/** Retries journaled Hindsight writes. A failed attempt never drops the record. */
export async function flushOutbox(client: HindsightClient, state: SessionState): Promise<void> {
  if (state.outbox.length === 0) return
  const remaining: OutboxEntry[] = []
  for (const entry of state.outbox) {
    try {
      await client.retainDocument({
        documentID: entry.documentID,
        text: entry.text,
        tags: entry.tags,
        metadata: entry.metadata,
        replace: true,
      })
    } catch (error) {
      entry.attempts += 1
      entry.lastError = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error"
      // Hard failures after five attempts stay in the journal and stay reportable; they are never hidden.
      remaining.push(entry)
    }
  }
  state.outbox = remaining
}
