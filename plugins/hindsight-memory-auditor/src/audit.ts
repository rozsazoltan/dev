import { createHash } from "node:crypto"
import type { Finding, MemoryUnit, Operation, Plan } from "./types.ts"

/** Loose text used for advisory checks such as length; never for retirement decisions. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Identity for retirement: the trimmed text must match exactly, so case, punctuation, operators and
 * even whitespace inside a quoted value keep distinct facts apart.
 */
export function strictKey(text: string): string {
  return text.trim()
}

/** Stable identifier for a curated operation, derived from its exact payload. */
export function digestId(prefix: string, payload: string): string {
  return `${prefix}-${digest(payload).slice(0, 12)}`
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function timestamp(memory: MemoryUnit): string {
  return memory.mentioned_at ?? memory.date ?? ""
}

function keeperTimestamp(memory: MemoryUnit): string {
  return memory.updated_at ?? timestamp(memory)
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function validatePlan(plan: Plan): boolean {
  if (!plan || !plan.bank || !Array.isArray(plan.findings) || !Array.isArray(plan.operations)) return false
  const ids = plan.operations.map((operation) => operation?.id)
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) return false
  const hash = digest(canonical({ bank: plan.bank, findings: plan.findings, operations: plan.operations }))
  return plan.hash === hash && plan.id === hash.slice(0, 16)
}

/**
 * Deterministic, evidence-free triage over the bank. It finds exact duplicates, very short
 * fragments and near-identical leading claims; judgement about real-world truth stays with the
 * agent and the repository evidence, so nothing here retires a memory on its own.
 */
/** Only world and experience facts can be curated; observations are derived and read-only. */
export function curatable(memory: MemoryUnit): boolean {
  const type = memory.fact_type ?? memory.type
  return type === "world" || type === "experience"
}

export function scan(memories: MemoryUnit[], options: { minTextLength?: number } = {}): Finding[] {
  const minTextLength = options.minTextLength ?? 40
  const valid = memories.filter((memory) => (memory.state ?? "valid") === "valid")
  // Retirement candidates must be curatable, so a duplicate never targets a derived observation.
  const curatableValid = valid.filter(curatable)
  const findings: Finding[] = []

  const byText = new Map<string, MemoryUnit[]>()
  for (const memory of curatableValid) {
    const key = canonical([strictKey(memory.text), memory.fact_type ?? memory.type, memory.context ?? null,
      memory.tags ?? null, memory.mentioned_at ?? null, memory.date ?? null, memory.document_id ?? null,
      memory.source_memory_ids ?? null, memory.source_memories ?? null, memory.observation_scopes ?? null, memory.metadata ?? null])
    if (!key) continue
    byText.set(key, [...(byText.get(key) ?? []), memory])
  }
  for (const [key, group] of byText) {
    if (group.length < 2) continue
    const ordered = [...group].sort((left, right) => keeperTimestamp(right).localeCompare(keeperTimestamp(left)))
    findings.push({
      id: `dup-${digest(key).slice(0, 12)}`,
      state: "DUPLICATE",
      severity: "medium",
      memoryIds: ordered.map((memory) => memory.id),
      keep: ordered[0].id,
      detail: `${group.length} memories hold the same fact; keep the newest and retire the rest.`,
      evidence: ordered[0].text.slice(0, 160),
    })
  }

  for (const memory of valid) {
    const text = normalize(memory.text)
    if (text.length === 0 || text.length >= minTextLength) continue
    findings.push({
      id: `short-${memory.id}`,
      state: "LOW_SIGNAL",
      severity: "low",
      memoryIds: [memory.id],
      detail: `Fragment shorter than ${minTextLength} characters; decide manually whether it carries a fact.`,
      evidence: memory.text.slice(0, 160),
    })
  }

  const byId = new Map(memories.map((memory) => [memory.id, memory]))
  for (const memory of valid) {
    const sourceIds = memory.source_memory_ids ?? []
    if (sourceIds.length === 0) continue
    const sources = sourceIds.map((id) => byId.get(id)).filter((source): source is MemoryUnit => Boolean(source))
    if (sources.length === 0) continue
    const retired = sources.filter((source) => (source.state ?? "valid") !== "valid")
    if (retired.length === 0) continue
    findings.push({
      id: `derived-${memory.id}`,
      state: "STALE_DERIVED",
      severity: "medium",
      memoryIds: [memory.id, ...sources.map((source) => source.id)],
      detail: `Observation built from ${retired.length} retired source memory/memories; it likely repeats content that was already retired.`,
      evidence: memory.text.slice(0, 160),
    })
  }

  return findings
}

/** Packs a plan so its id and hash are derived from the bank and the exact operations. */
export function packPlan(bank: string, findings: Finding[], operations: Operation[], now = new Date()): Plan {
  const payload = canonical({ bank, findings, operations })
  const hash = digest(payload)
  return {
    id: hash.slice(0, 16),
    hash,
    bank,
    createdAt: now.toISOString(),
    findings: structuredClone(findings),
    operations: structuredClone(operations),
  }
}

/**
 * Turns findings into operations. Only exact duplicates produce automatic operations; everything
 * else needs a human decision, so the default plan never invents a correction.
 */
export function buildPlan(bank: string, findings: Finding[], memories: MemoryUnit[], now = new Date()): Plan {
  const byId = new Map(memories.map((memory) => [memory.id, memory]))
  const operations: Operation[] = []
  for (const finding of findings) {
    if (finding.state !== "DUPLICATE" || !finding.keep) continue
    for (const memoryId of finding.memoryIds) {
      if (memoryId === finding.keep) continue
      const memory = byId.get(memoryId)
      if (!memory) continue
      const keeper = byId.get(finding.keep)
      operations.push({
        id: `invalidate-${memoryId}`,
        kind: "invalidate",
        memoryId,
        reason: "Duplicate of a newer memory with identical text (memory auditor)",
        before: memory.text,
        keep: finding.keep,
        keepBefore: keeper?.text ?? "",
        beforeSnapshot: structuredClone(memory),
        keeperSnapshot: keeper ? structuredClone(keeper) : undefined,
      })
    }
  }
  return packPlan(bank, findings, operations, now)
}
