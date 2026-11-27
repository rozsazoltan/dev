import assert from "node:assert/strict"
import { test } from "node:test"
import { buildPlan, normalize, scan, packPlan, validatePlan } from "../src/audit.ts"

const memory = (id, text, extra = {}) => ({ id, text, state: "valid", fact_type: "world", ...extra })

test("normalize ignores case, punctuation and spacing", () => {
  assert.equal(normalize("Bank:  Coding-Agent::Dev!"), "bank coding agent dev")
})

test("scan groups identical text and keeps the newest memory", () => {
  const memories = [
    memory("a", "The preset pins commit 305e335.", { updated_at: "2026-11-20T00:00:00Z" }),
    memory("b", "The preset pins commit 305e335.", { updated_at: "2026-11-26T00:00:00Z" }),
    memory("c", "Something else entirely about the bank layout.", { updated_at: "2026-11-25T00:00:00Z" }),
  ]
  const findings = scan(memories)
  const duplicate = findings.find((finding) => finding.state === "DUPLICATE")
  assert.ok(duplicate)
  assert.equal(duplicate.keep, "b")
  assert.deepEqual(duplicate.memoryIds.sort(), ["a", "b"])
})

test("scan keeps distinct operators apart", () => {
  const memories = [
    memory("a", "Reject requests when retries < 3."),
    memory("b", "Reject requests when retries > 3."),
  ]
  const findings = scan(memories)
  assert.equal(findings.some((finding) => finding.state === "DUPLICATE"), false)
})

test("scan keeps quoted whitespace differences apart", () => {
  const memories = [
    memory("a", 'The separator is "  ".'),
    memory("b", 'The separator is " ".'),
  ]
  const findings = scan(memories)
  assert.equal(findings.some((finding) => finding.state === "DUPLICATE"), false)
})

test("scan flags short fragments without retiring them", () => {
  const findings = scan([memory("a", "ok")])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].state, "LOW_SIGNAL")
})

test("scan flags observations whose sources were retired", () => {
  const memories = [
    memory("src", "Source fact that was retired by a later decision here.", { state: "invalidated" }),
    memory("obs", "Observation repeating the retired source fact verbatim-ish.", { fact_type: "observation", source_memory_ids: ["src"] }),
  ]
  const findings = scan(memories)
  const stale = findings.find((finding) => finding.state === "STALE_DERIVED")
  assert.ok(stale)
  assert.deepEqual(stale.memoryIds, ["obs", "src"])
})

test("buildPlan only emits operations for duplicates and is deterministic", () => {
  const memories = [
    memory("a", "Same fact text for planning purposes here.", { updated_at: "2026-11-20T00:00:00Z" }),
    memory("b", "Same fact text for planning purposes here.", { updated_at: "2026-11-26T00:00:00Z" }),
  ]
  const findings = scan(memories)
  const first = buildPlan("bank", findings, memories, new Date("2026-11-27T00:00:00Z"))
  const second = buildPlan("bank", findings, memories, new Date("2026-11-27T00:00:00Z"))
  assert.equal(first.operations.length, 1)
  assert.equal(first.operations[0].memoryId, "a")
  assert.equal(first.operations[0].kind, "invalidate")
  assert.equal(first.hash, second.hash)
})

test("duplicate identity ignores updated_at but honors semantic date", () => {
  const base = memory("a", "Same fact text for planning purposes here.", { updated_at: "2026-11-20" })
  const newer = memory("b", base.text, { updated_at: "2026-11-26" })
  assert.equal(scan([base, newer]).some((finding) => finding.state === "DUPLICATE"), true)
  assert.equal(scan([base, memory("c", base.text, { date: "2020-01-01" })]).some((finding) => finding.state === "DUPLICATE"), false)
  assert.equal(scan([base, memory("d", base.text, { context: "other" })]).some((finding) => finding.state === "DUPLICATE"), false)
  const historic = { ...base, mentioned_at: "2026-11-27", date: "2020-01-01" }
  assert.equal(scan([historic, { ...historic, id: "e", date: "2021-01-01" }]).some((finding) => finding.state === "DUPLICATE"), false)
  assert.equal(scan([base, { ...newer, source_memories: [{ id: "different-source" }] }]).some((finding) => finding.state === "DUPLICATE"), false)
})

test("plan integrity binds keeper and context with canonical key ordering", () => {
  const a = packPlan("b", [], [{ id: "op", kind: "edit", memoryId: "m", reason: "r", before: "x", text: "y", context: "a" }])
  const changed = structuredClone(a)
  changed.operations[0].context = "b"
  assert.equal(validatePlan(a), true)
  assert.equal(validatePlan(changed), false)
  const reordered = packPlan("b", [], [{ context: "a", text: "y", before: "x", reason: "r", memoryId: "m", kind: "edit", id: "op" }])
  assert.equal(a.hash, reordered.hash)
  const keeperChanged = packPlan("b", [], [{ ...a.operations[0], keep: "new-keeper", keepBefore: "text" }])
  assert.notEqual(a.hash, keeperChanged.hash)
  assert.equal(validatePlan(JSON.parse(JSON.stringify(packPlan("b", [], [{ ...a.operations[0], unused: undefined }])))), true)
})
