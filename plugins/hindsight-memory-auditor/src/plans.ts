import type { Plan } from "./types.ts"
import { validatePlan } from "./audit.ts"

export interface StorageLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

/**
 * Plans persist per session, so a plan survives a restart and one session never sees or
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
    const snapshot = structuredClone(plan)
    if (!validatePlan(snapshot)) throw new Error("Invalid plan integrity.")
    await this.#serial(sessionID, async () => {
      const plans = await this.#all(sessionID)
      // Persisted plans survive restarts; human approval does not.
      delete plans[snapshot.id]
      plans[snapshot.id] = snapshot
      await this.#storage.set(this.#key(sessionID), plans)
    })
  }

  async load(sessionID: string, id: string): Promise<Plan | undefined> {
    const value = await this.#storage.get(this.#key(sessionID))
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const plan = (value as Record<string, Plan>)[id]
    // A valid plan under another key is not the plan that was requested.
    return plan && plan.id === id && validatePlan(plan) ? structuredClone(plan) : undefined
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
    return value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value as Record<string, Plan>) : {}
  }
}
