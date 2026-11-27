import type { Plan } from "./types.ts"

export interface StorageLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

const KEEP = 5

/**
 * Plans persist per session, so an approval survives a restart and one session never sees or
 * clears another session's plans.
 */
export class PlanStore {
  readonly #storage: StorageLike
  readonly #prefix: string
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(storage: StorageLike, prefix = "hindsight-memory-auditor.plans") {
    this.#storage = storage
    this.#prefix = prefix
  }

  async save(sessionID: string, plan: Plan): Promise<void> {
    await this.#serial(sessionID, async () => {
      const plans = await this.#all(sessionID)
      // Re-inserting keeps the newest save last in retention order.
      delete plans[plan.id]
      plans[plan.id] = plan
      const ids = Object.keys(plans)
      for (const stale of ids.slice(0, Math.max(0, ids.length - KEEP))) delete plans[stale]
      await this.#storage.set(this.#key(sessionID), plans)
    })
  }

  async load(sessionID: string, id: string): Promise<Plan | undefined> {
    return (await this.#all(sessionID))[id]
  }

  async clear(sessionID: string): Promise<void> {
    await this.#serial(sessionID, async () => {
      await this.#storage.set(this.#key(sessionID), {})
    })
  }

  /** One read-modify-write queue per session, so a clear cannot land inside a save. */
  async #serial<T>(sessionID: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sessionID) ?? Promise.resolve()
    const next = previous.then(run, run)
    this.#queues.set(sessionID, next.catch(() => undefined))
    return next
  }

  #key(sessionID: string): string {
    return `${this.#prefix}.${sessionID}`
  }

  async #all(sessionID: string): Promise<Record<string, Plan>> {
    const value = await this.#storage.get(this.#key(sessionID))
    return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, Plan>) } : {}
  }
}
