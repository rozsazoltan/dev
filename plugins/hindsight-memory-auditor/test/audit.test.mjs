import assert from "node:assert/strict"
import { test } from "node:test"
import { buildPlan, normalize, scan } from "../src/audit.ts"

const memory = (id, text, extra = {}) => ({ id, text, state: "valid", ...extra })

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

test("scan flags short fragments without retiring them", () => {
  const findings = scan([memory("a", "ok")])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].state, "LOW_SIGNAL")
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
