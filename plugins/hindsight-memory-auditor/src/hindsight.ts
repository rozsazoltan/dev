import type { AuditorConfig, Inventory, MemoryUnit } from "./types.ts"

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

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

  async getMemory(memoryId: string): Promise<MemoryUnit> {
    return this.#request<MemoryUnit>("GET", `/memories/${encodeURIComponent(memoryId)}`)
  }

  /** Soft-retires a memory: excluded from recall and consolidation, still readable and restorable. */
  async invalidate(memoryId: string, reason: string): Promise<MemoryUnit> {
    return this.#request<MemoryUnit>("PATCH", `/memories/${encodeURIComponent(memoryId)}`, {
      state: "invalidated",
      reason,
    })
  }

  async restore(memoryId: string, reason: string): Promise<MemoryUnit> {
    return this.#request<MemoryUnit>("PATCH", `/memories/${encodeURIComponent(memoryId)}`, { state: "valid", reason })
  }

  /** Pages through the whole bank up to `maxMemories`; `truncated` marks an incomplete inventory. */
  async inventory(): Promise<Inventory> {
    const memories: MemoryUnit[] = []
    let offset = 0
    let truncated = false
    for (;;) {
      const page = await this.listMemories({ limit: this.#config.pageSize, offset })
      const items = page.items ?? []
      memories.push(...items)
      offset += items.length
      if (items.length < this.#config.pageSize) break
      if (memories.length >= this.#config.maxMemories) {
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
    const headers: Record<string, string> = { accept: "application/json" }
    if (body !== undefined) headers["content-type"] = "application/json"
    if (this.#config.token) headers.authorization = `Bearer ${this.#config.token}`
    const response = await this.#fetch(`${this.#config.apiUrl}/v1/default/banks/${encodeURIComponent(this.#config.bank)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Hindsight ${method} ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
    }
    return (await response.json()) as T
  }
}
