import type { AuditorConfig, Inventory, MemoryUnit } from "./types.ts"

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

  constructor(config: AuditorConfig, fetchImpl: FetchLike = fetch) {
    this.#config = config
    this.#fetch = fetchImpl
  }

  get bank(): string {
    return this.#config.bank
  }

  async listMemories(input: { limit: number; offset: number; state?: string }): Promise<ListResponse> {
    const query = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) })
    if (input.state) query.set("state", input.state)
    return this.#request<ListResponse>("GET", `/memories/list?${query}`)
  }

  /** Banks the server knows, so a mis-resolved bank is visible before any write. */
  async banks(): Promise<string[]> {
    const response = await this.#fetchResponse("GET", "/v1/default/banks", undefined, "")
    const body = (await response.json()) as { banks?: Array<{ bank_id?: string }> }
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

  async getMemory(memoryId: string): Promise<MemoryUnit> {
    return this.#request<MemoryUnit>("GET", `/memories/${encodeURIComponent(memoryId)}`)
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
    const memories: MemoryUnit[] = []
    let offset = 0
    let truncated = false
    for (;;) {
      const remaining = this.#config.maxMemories - memories.length
      if (remaining <= 0) {
        truncated = true
        break
      }
      const limit = Math.min(this.#config.pageSize, remaining)
      const page = await this.listMemories({ limit, offset })
      const items = (page.items ?? []).slice(0, limit)
      memories.push(...items)
      offset += items.length
      if (items.length < limit) break
      if (memories.length >= this.#config.maxMemories) {
        // A full page at the cap means more may exist; report partial coverage.
        truncated = true
        break
      }
    }
    const valid = memories.filter((memory) => (memory.state ?? "valid") === "valid").length
    return {
      bank: this.#config.bank,
      scanned: memories.length,
      valid,
      invalidated: memories.length - valid,
      truncated,
      memories,
    }
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#fetchResponse(method, path, body)
    return (await response.json()) as T
  }

  /** Sends a mutation and ignores the body, so a changed response shape cannot break a request that worked. */
  async #send(method: string, path: string, body: unknown): Promise<void> {
    const response = await this.#fetchResponse(method, path, body)
    // The payload is unused; release the connection instead of leaving the body unread.
    await response.body?.cancel().catch(() => undefined)
  }

  async #fetchResponse(method: string, path: string, body?: unknown, pathOverride?: string): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" }
    if (body !== undefined) headers["content-type"] = "application/json"
    if (this.#config.token) headers.authorization = `Bearer ${this.#config.token}`
    const base = pathOverride === undefined ? `/v1/default/banks/${encodeURIComponent(this.#config.bank)}` : ""
    const target = pathOverride === undefined ? `${base}${path}` : pathOverride
    const response = await this.#fetch(`${this.#config.apiUrl}${target}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Hindsight ${method} ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
    }
    return response
  }
}
