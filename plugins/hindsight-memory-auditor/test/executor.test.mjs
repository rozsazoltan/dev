import assert from "node:assert/strict"
import { test } from "node:test"
import { applyPlan, verifyPlan } from "../src/executor.ts"

const plan = {
  id: "plan-1",
  hash: "hash",
  bank: "bank",
  createdAt: "2026-11-27T00:00:00Z",
  findings: [],
  operations: [
    { id: "invalidate-a", kind: "invalidate", memoryId: "a", reason: "duplicate", before: "same text" },
    { id: "invalidate-b", kind: "invalidate", memoryId: "b", reason: "duplicate", before: "older text" },
  ],
}

function fakeClient(overrides = {}) {
  const calls = []
  return {
    calls,
    async getMemory(id) {
      return overrides[id] ?? { id, text: "same text", state: "valid" }
    },
    async invalidate(id, reason) {
      calls.push({ id, reason })
      return { id, text: "same text", state: "invalidated" }
    },
    async restore(id, reason) {
      calls.push({ id, reason })
      return { id, text: "same text", state: "valid" }
    },
  }
}

test("audit-only mode refuses to apply anything", async () => {
  await assert.rejects(() => applyPlan(fakeClient(), plan, ["invalidate-a"], { auditOnly: true }), /Audit-only mode/)
})

test("only approved operations run", async () => {
  const client = fakeClient()
  const report = await applyPlan(client, plan, ["invalidate-a"], { auditOnly: false })
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.id), ["a"])
})

test("a target that changed after planning is skipped", async () => {
  const client = fakeClient({ a: { id: "a", text: "edited later", state: "valid" } })
  const report = await applyPlan(client, plan, ["invalidate-a"], { auditOnly: false })
  assert.equal(report.results[0].status, "skipped")
  assert.match(report.results[0].detail, /changed after the plan/)
})

test("an already invalidated target is skipped", async () => {
  const client = fakeClient({ a: { id: "a", text: "same text", state: "invalidated" } })
  const report = await applyPlan(client, plan, ["invalidate-a"], { auditOnly: false })
  assert.equal(report.results[0].status, "skipped")
})

test("unknown operation IDs are reported, not applied", async () => {
  const report = await applyPlan(fakeClient(), plan, ["nope"], { auditOnly: false })
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0].status, "failed")
})

test("a duplicate is skipped when its keeper is no longer valid", async () => {
  const client = fakeClient({ a: { id: "a", text: "same text", state: "valid" }, keeper: { id: "keeper", text: "same text", state: "invalidated" } })
  const guarded = { ...plan, operations: [{ ...plan.operations[0], keep: "keeper", keepBefore: "same text" }] }
  const report = await applyPlan(client, guarded, ["invalidate-a"], { auditOnly: false })
  assert.equal(report.results[0].status, "skipped")
  assert.match(report.results[0].detail, /keeper is no longer valid/)
})

test("a duplicate is skipped when its keeper changed", async () => {
  const client = fakeClient({ a: { id: "a", text: "same text", state: "valid" }, keeper: { id: "keeper", text: "rewritten", state: "valid" } })
  const guarded = { ...plan, operations: [{ ...plan.operations[0], keep: "keeper", keepBefore: "same text" }] }
  const report = await applyPlan(client, guarded, ["invalidate-a"], { auditOnly: false })
  assert.equal(report.results[0].status, "skipped")
  assert.match(report.results[0].detail, /keeper changed/)
})

test("verify reports the observed state", async () => {
  const report = await verifyPlan(fakeClient({ a: { id: "a", text: "same text", state: "invalidated" } }), plan, ["invalidate-a"])
  assert.equal(report.results[0].status, "applied")
  assert.match(report.results[0].detail, /Observed state: invalidated/)
})
