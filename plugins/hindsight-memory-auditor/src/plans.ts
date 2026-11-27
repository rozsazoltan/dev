import type { Plan } from "./types.ts"

export interface StorageLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

const KEY = "hindsight-memory-auditor.plans"
const KEEP = 5

/**
 * Plans survive a restart so an approval is not lost with the process. Only the last few are kept,
 * and a plan still carries its bank, hash and exact operation IDs.
 */
export class PlanStore {
  readonly #storage: StorageLike
  readonly #key: string

  constructor(storage: StorageLike, key = KEY) {
    this.#storage = storage
    this.#key = key
  }

  async save(plan: Plan): Promise<void> {
    const plans = await this.#all()
    plans[plan.id] = plan
    const ids = Object.keys(plans)
    for (const stale of ids.slice(0, Math.max(0, ids.length - KEEP))) delete plans[stale]
    await this.#storage.set(this.#key, plans)
  }

  async load(id: string): Promise<Plan | undefined> {
    return (await this.#all())[id]
  }

  async #all(): Promise<Record<string, Plan>> {
    const value = await this.#storage.get(this.#key)
    return value && typeof value === "object" && !Array.isArray(value) ? ({ ...(value as Record<string, Plan>) }) : {}
  }
}
