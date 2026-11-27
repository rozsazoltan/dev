import type { AuditorConfig, Inventory, MemoryUnit } from "./types.ts"
import { createHash } from "node:crypto"

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface RecallResult {
  id: string
  text: string
  type?: string | null
  entities?: string[] | null
  document_id?: string | null
  mentioned_at?: string | null
  scores?: { final?: number; semantic?: number | null } | null
}

export interface EntitySummary {
  id: string
  canonical_name: string
  mention_count: number
  first_seen?: string | null
  last_seen?: string | null
}

export interface ListResponse {
  items?: MemoryUnit[]
  total?: number
}

/**
 * Minimal typed Hindsight client. Every route is built here; the model can only pass memory IDs,
 * never a URL, method or bank. Deleting a whole bank or bulk-clearing memories stays unreachable.
 */
export class HindsightClient {
  readonly #config: AuditorConfig
  readonly #fetch: FetchLike
  readonly #signal?: AbortSignal

  constructor(config: AuditorConfig, fetchImpl: FetchLike = fetch, signal?: AbortSignal) {
    this.#config = config
    this.#fetch = fetchImpl
    this.#signal = signal
  }

  get bank(): string {
    return this.#config.bank
  }

  /** Per-call clients avoid sharing mutable cancellation state across sessions. */
  withSignal(signal?: AbortSignal): HindsightClient {
    return new HindsightClient(this.#config, this.#fetch, signal)
  }

  async listMemories(input: { limit: number; offset: number; state?: string; factType?: string }): Promise<ListResponse> {
    const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) })
    if (input.state) query.set("state", input.state)
    if (input.factType) query.set("type", input.factType)
    const response = await this.#request<ListResponse>("GET", `/memories/list?${query}`)
    return { ...response, items: normalizeList(response) }
  }

  /** Banks the server knows, so a mis-resolved bank is visible before any write. */
  async banks(): Promise<string[]> {
    const body = await this.#request<{ banks?: Array<{ bank_id?: string }> }>("GET", "/v1/default/banks", undefined, "/v1/default/banks")
    return (body.banks ?? []).map((bank) => bank.bank_id ?? "").filter(Boolean)
  }

  /** Semantic search: ranked by meaning, not by keywords. */
  async recall(query: string, limit: number): Promise<RecallResult[]> {
    const response = await this.#request<{ results?: RecallResult[] }>("POST", "/memories/recall", { query })
    return (response.results ?? []).slice(0, limit)
  }

  /** Entities the bank knows about, with how often each is mentioned. */
  async entities(input: { limit: number; offset: number }): Promise<{ items: EntitySummary[]; total: number }> {
    const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) })
    return this.#request<{ items: EntitySummary[]; total: number }>("GET", `/entities?${query}`)
  }

  /** Retains one fact written by the auditor; the body is ignored like every mutation. */
  async retain(item: { content: string; context?: string; documentId: string; metadata?: Record<string, string> }): Promise<void> {
    await this.#send("POST", "/memories", {
      items: [
        {
          content: item.content,
          context: item.context,
          document_id: item.documentId,
          metadata: item.metadata,
        },
      ],
    })
  }

  /** Rewrites a memory's text; Hindsight re-embeds it and drops derived observations. */
  async updateText(memoryId: string, text: string): Promise<void> {
    await this.#send("PATCH", `/memories/${encodeURIComponent(memoryId)}`, { text })
  }

  /** Memories that carry a document id, used to find a retained merge afterwards. */
  async byDocument(documentId: string): Promise<MemoryUnit[]> {
    const result: MemoryUnit[] = []
    for (let offset = 0; offset < this.#config.maxMemories; offset += this.#config.pageSize) {
      const query = new URLSearchParams({ document_id: documentId, limit: String(Math.min(this.#config.pageSize, this.#config.maxMemories - offset)), offset: String(offset) })
      const page = await this.#request<ListResponse>("GET", `/memories/list?${query}`)
      const items = normalizeList(page)
      if (items.some((item) => item.document_id !== documentId)) throw new Error("Document filter returned unrelated memories.")
      result.push(...items)
      if (items.length < Math.min(this.#config.pageSize, this.#config.maxMemories - offset) ||
          page.total === result.length) return result
    }
    throw new Error("Document lookup reached its safety cap; replacement coverage is incomplete.")
  }

  async getMemory(memoryId: string): Promise<MemoryUnit> {
    const memory = normalizeMemory(await this.#request<unknown>("GET", `/memories/${encodeURIComponent(memoryId)}`))
    if (memory.id !== memoryId || !["valid", "invalidated"].includes(memory.state ?? "")) {
      throw new Error("Invalid Hindsight detail response: target identity and explicit state are required.")
    }
    return memory
  }

  /**
   * Soft-retires a memory: excluded from recall and consolidation, still readable and restorable.
   * The response body is not trusted; memory_auditor_verify reads the state back instead.
   */
  async invalidate(memoryId: string, reason: string): Promise<void> {
    await this.#send("PATCH", `/memories/${encodeURIComponent(memoryId)}`, { state: "invalidated", reason })
  }

  async restore(memoryId: string, reason: string): Promise<void> {
    await this.#send("PATCH", `/memories/${encodeURIComponent(memoryId)}`, { state: "valid", reason })
  }

  /** Pages through the whole bank up to `maxMemories`; `truncated` marks an incomplete inventory. */
  async inventory(): Promise<Inventory> {
    const first = await this.#inventoryPages()
    const memories: MemoryUnit[] = []
    const missingIds: string[] = []
    let changed = first.changed
    let unavailableVersions = false
    for (const listed of first.items) {
      try {
        const memory = await this.getMemory(listed.id)
        if (memory.text !== listed.text ||
            (listed.updated_at !== undefined && memory.updated_at !== undefined && memory.updated_at !== listed.updated_at)) changed = true
        if (listed.updated_at !== undefined && memory.updated_at === undefined) unavailableVersions = true
        memories.push(memory)
      } catch (error) {
        this.#signal?.throwIfAborted()
        // An unavailable detail is a coverage gap, not permission to silently drop a memory.
        missingIds.push(listed.id)
        memories.push(listed)
      }
    }
    const last = await this.#inventoryPages()
    changed ||= last.changed || createInventoryRevision(first.items) !== createInventoryRevision(last.items)
    const truncated = first.truncated || last.truncated
    const valid = memories.filter((memory) => (memory.state ?? "valid") === "valid").length
    return {
      bank: this.#config.bank,
      scanned: memories.length,
      valid,
      invalidated: memories.length - valid,
      truncated,
      revision: createInventoryRevision(memories),
      changed,
      missingIds,
      complete: !truncated && !changed && missingIds.length === 0,
      warnings: [
        "Observed inventory revision, not an atomic server snapshot.",
        ...(unavailableVersions ? ["Detail responses omit listing update timestamps; per-record version comparison is unavailable."] : []),
        ...(truncated ? ["Inventory reached its configured safety cap."] : []),
        ...(changed ? ["Inventory changed or repeated IDs during collection."] : []),
        ...(missingIds.length ? ["Some detail records could not be read; inspect missingIds."] : []),
      ],
      memories,
    }
  }

  async #inventoryPages(): Promise<{ items: MemoryUnit[]; truncated: boolean; changed: boolean }> {
    const byId = new Map<string, MemoryUnit>()
    let total: number | undefined
    let changed = false
    for (let offset = 0; offset < this.#config.maxMemories;) {
      const limit = Math.min(this.#config.pageSize, this.#config.maxMemories - offset)
      const page = await this.listMemories({ limit, offset })
      const items = page.items!
      if (items.length > limit) throw new Error("Hindsight exceeded the requested page size.")
      if (page.total !== undefined) {
        if (!Number.isSafeInteger(page.total) || page.total < 0) throw new Error("Invalid inventory total.")
        if (total !== undefined && total !== page.total) changed = true
        total = page.total
      }
      for (const item of items) {
        if (byId.has(item.id)) changed = true
        else byId.set(item.id, item)
      }
      offset += items.length
      if (items.length < limit) {
        if (total !== undefined && total !== byId.size) changed = true
        return { items: [...byId.values()], truncated: false, changed }
      }
      if (offset >= this.#config.maxMemories) {
        return { items: [...byId.values()], truncated: total === undefined || total > offset, changed }
      }
    }
    return { items: [...byId.values()], truncated: true, changed }
  }

  #requestSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.#config.requestTimeoutMs ?? 15000)
    return this.#signal ? AbortSignal.any([this.#signal, timeout]) : timeout
  }

  async #request<T>(method: string, path: string, body?: unknown, pathOverride?: string): Promise<T> {
    const signal = this.#requestSignal()
    const response = await this.#fetchResponse(method, path, body, pathOverride, signal)
    return await abortable(response.json(), signal) as T
  }

  /** Sends a mutation and ignores the body, so a changed response shape cannot break a request that worked. */
  async #send(method: string, path: string, body: unknown): Promise<void> {
    const signal = this.#requestSignal()
    const response = await this.#fetchResponse(method, path, body, undefined, signal)
    // The payload is unused; release the connection instead of leaving the body unread.
    await abortable(response.body?.cancel() ?? Promise.resolve(), signal)
  }

  async #fetchResponse(method: string, path: string, body: unknown, pathOverride: string | undefined, signal: AbortSignal): Promise<Response> {
    signal.throwIfAborted()
    const headers: Record<string, string> = { accept: "application/json" }
    if (body !== undefined) headers["content-type"] = "application/json"
    if (this.#config.token) headers.authorization = `Bearer ${this.#config.token}`
    const base = pathOverride === undefined ? `/v1/default/banks/${encodeURIComponent(this.#config.bank)}` : ""
    const target = pathOverride === undefined ? `${base}${path}` : pathOverride
    const response = await abortable(this.#fetch(`${this.#config.apiUrl}${target}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }), signal)
    if (!response.ok) {
      await abortable(response.body?.cancel() ?? Promise.resolve(), signal).catch(() => undefined)
      throw new Error(`Hindsight ${method} ${path} failed with ${response.status}`)
    }
    return response
  }
}

function normalizeMemory(value: unknown): MemoryUnit {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Hindsight memory response")
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || !raw.id || typeof raw.text !== "string") throw new Error("Invalid Hindsight memory response: id and text are required")
  if (raw.fact_type !== undefined && raw.type !== undefined && raw.fact_type !== raw.type) throw new Error("Conflicting Hindsight memory types.")
  if (raw.context !== undefined && raw.context !== null && typeof raw.context !== "string") throw new Error("Invalid memory context.")
  return { ...raw, id: raw.id, text: raw.text, fact_type: typeof raw.fact_type === "string" ? raw.fact_type : typeof raw.type === "string" ? raw.type : undefined } as MemoryUnit
}

function normalizeList(value: ListResponse): MemoryUnit[] {
  if (!value || !Array.isArray(value.items)) throw new Error("Invalid Hindsight memory list response")
  return value.items.map(normalizeMemory)
}

function createInventoryRevision(memories: MemoryUnit[]): string {
  return createHash("sha256").update(JSON.stringify([...memories].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex")
}

async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error("Hindsight request aborted."))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([pending, cancelled]) }
  finally { signal.removeEventListener("abort", abort) }
}
