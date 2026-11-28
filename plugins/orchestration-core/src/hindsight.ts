import type { OrchestrationConfig } from "./config.ts"
import type { DocumentDetail, DocumentSummary, RecallHit } from "./types.ts"

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface ListDocuments {
  items?: DocumentSummary[]
  total?: number
}

/**
 * Minimal typed Hindsight client. Every route is built here; callers pass document IDs and filters,
 * never a URL or a bank. Project memory is never deleted; only expired temporary documents are.
 */
export class HindsightClient {
  readonly #config: OrchestrationConfig
  readonly #fetch: FetchLike
  readonly #signal?: AbortSignal

  constructor(config: OrchestrationConfig, fetchImpl: FetchLike = fetch, signal?: AbortSignal) {
    this.#config = config
    this.#fetch = fetchImpl
    this.#signal = signal
  }

  get bank(): string {
    return this.#config.bank
  }

  withSignal(signal?: AbortSignal): HindsightClient {
    return new HindsightClient(this.#config, this.#fetch, signal)
  }

  async banks(): Promise<string[]> {
    const response = await this.#request<{ banks?: Array<{ bank_id?: string }> }>("GET", "/v1/default/banks", undefined, true)
    return (response.banks ?? []).map((bank) => bank.bank_id ?? "").filter(Boolean)
  }

  async listDocuments(input: { q?: string; tags?: string[]; limit?: number; offset?: number } = {}): Promise<{ items: DocumentSummary[]; total?: number }> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 50), offset: String(input.offset ?? 0) })
    if (input.q) query.set("q", input.q)
    for (const tag of input.tags ?? []) query.append("tags", tag)
    const page = await this.#request<ListDocuments>("GET", `/documents?${query}`)
    if (!Array.isArray(page.items)) throw new Error("Invalid Hindsight document list response")
    return { items: page.items, total: page.total }
  }

  async getDocument(documentID: string): Promise<DocumentDetail | undefined> {
    try {
      return await this.#request<DocumentDetail>("GET", `/documents/${encodeURIComponent(documentID)}`)
    } catch (error) {
      if (error instanceof HindsightHttpError && error.status === 404) return undefined
      throw error
    }
  }

  /**
   * Creates or replaces one document. `replace` keeps exactly one current record under the stable ID;
   * Hindsight re-derives memory units from the new text.
   */
  async retainDocument(input: {
    documentID: string
    text: string
    tags: string[]
    metadata: Record<string, string>
    replace: boolean
    context?: string
  }): Promise<void> {
    await this.#send("POST", "/memories", {
      items: [
        {
          content: input.text,
          document_id: input.documentID,
          tags: input.tags,
          metadata: input.metadata,
          context: input.context,
          update_mode: input.replace ? "replace" : "append",
        },
      ],
    })
  }

  async deleteDocument(documentID: string): Promise<void> {
    await this.#send("DELETE", `/documents/${encodeURIComponent(documentID)}`)
  }

  async recall(input: { query: string; limit?: number; types?: string[] }): Promise<RecallHit[]> {
    const response = await this.#request<{ results?: RecallHit[] }>("POST", "/memories/recall", {
      query: input.query,
      ...(input.types ? { types: input.types } : {}),
    })
    return (response.results ?? []).slice(0, input.limit ?? 10)
  }

  async #request<T>(method: string, path: string, body?: unknown, absolute = false): Promise<T> {
    const signal = this.#signalFor()
    const response = await this.#fetchResponse(method, path, body, absolute, signal)
    return (await abortable(response.json(), signal)) as T
  }

  async #send(method: string, path: string, body?: unknown): Promise<void> {
    const signal = this.#signalFor()
    const response = await this.#fetchResponse(method, path, body, false, signal)
    await abortable(response.body?.cancel() ?? Promise.resolve(), signal)
  }

  #signalFor(): AbortSignal {
    const timeout = AbortSignal.timeout(this.#config.requestTimeoutMs)
    return this.#signal ? AbortSignal.any([this.#signal, timeout]) : timeout
  }

  async #fetchResponse(method: string, path: string, body: unknown, absolute: boolean, signal: AbortSignal): Promise<Response> {
    signal.throwIfAborted()
    const headers: Record<string, string> = { accept: "application/json" }
    if (body !== undefined) headers["content-type"] = "application/json"
    if (this.#config.token) headers.authorization = `Bearer ${this.#config.token}`
    const base = absolute ? "" : `/v1/default/banks/${encodeURIComponent(this.#config.bank)}`
    const response = await abortable(
      this.#fetch(`${this.#config.apiUrl}${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      }),
      signal,
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new HindsightHttpError(method, path, response.status)
    }
    return response
  }
}

export class HindsightHttpError extends Error {
  readonly status: number
  constructor(method: string, path: string, status: number) {
    // The response body is never echoed: it can contain memory content.
    super(`Hindsight ${method} ${path} failed with ${status}`)
    this.status = status
  }
}

async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error("Hindsight request aborted"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    return await Promise.race([pending, cancelled])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
