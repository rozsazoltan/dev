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
 * Conservative identity for retirement: only whitespace collapses, so case, punctuation, operators
 * and signs still distinguish `retries < 3` from `retries > 3`.
 */
export function strictKey(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function timestamp(memory: MemoryUnit): string {
  return memory.updated_at ?? memory.mentioned_at ?? memory.date ?? ""
}

/**
 * Deterministic, evidence-free triage over the bank. It finds exact duplicates, very short
 * fragments and near-identical leading claims; judgement about real-world truth stays with the
 * agent and the repository evidence, so nothing here retires a memory on its own.
 */
export function scan(memories: MemoryUnit[], options: { minTextLength?: number } = {}): Finding[] {
  const minTextLength = options.minTextLength ?? 40
  const valid = memories.filter((memory) => (memory.state ?? "valid") === "valid")
  const findings: Finding[] = []

  const byText = new Map<string, MemoryUnit[]>()
  for (const memory of valid) {
    const key = strictKey(memory.text)
    if (!key) continue
    byText.set(key, [...(byText.get(key) ?? []), memory])
  }
  for (const [key, group] of byText) {
    if (group.length < 2) continue
    const ordered = [...group].sort((left, right) => timestamp(right).localeCompare(timestamp(left)))
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
      })
    }
  }
  const hash = digest(`${bank}\n${operations.map((operation) => `${operation.id}:${operation.before}`).join("\n")}`)
  return {
    id: hash.slice(0, 16),
    hash,
    bank,
    createdAt: now.toISOString(),
    findings,
    operations,
  }
}
