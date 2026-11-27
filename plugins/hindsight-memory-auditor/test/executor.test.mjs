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
    bank: "bank",
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

test("a plan from another bank is refused", async () => {
  const client = { ...fakeClient(), bank: "other" }
  await assert.rejects(() => applyPlan(client, plan, ["invalidate-a"], { auditOnly: false }), /belongs to bank bank/)
})

function mergeClient(overrides = {}) {
  const calls = []
  return {
    calls,
    bank: "bank",
    async getMemory(id) {
      return overrides[id] ?? { id, text: `text ${id}`, state: "valid" }
    },
    async retain(item) {
      calls.push({ kind: "retain", item })
    },
    async invalidate(id, reason) {
      calls.push({ kind: "invalidate", id, reason })
    },
    async updateText(id, text) {
      calls.push({ kind: "edit", id, text })
    },
    async byDocument(documentId) {
      return overrides["__retained"] ?? []
    },
  }
}

const mergeOperation = {
  id: "merge-1",
  kind: "merge",
  memoryId: "a",
  reason: "merge duplicates",
  before: "text a",
  sources: [
    { id: "a", text: "text a" },
    { id: "b", text: "text b" },
  ],
  text: "merged fact",
  documentId: "memory-auditor-merge-1",
}
const mergePlan = { id: "p", hash: "h", bank: "bank", createdAt: "now", findings: [], operations: [mergeOperation] }

test("merge retains the new text and retires every source", async () => {
  const client = mergeClient()
  const report = await applyPlan(client, mergePlan, ["merge-1"], { auditOnly: false })
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.kind), ["retain", "invalidate", "invalidate"])
  assert.equal(client.calls[0].item.content, "merged fact")
  assert.equal(client.calls[0].item.documentId, "memory-auditor-merge-1")
})

test("merge resumes when the replacement already exists", async () => {
  const client = mergeClient({
    a: { id: "a", text: "text a", state: "invalidated" },
    __retained: [{ id: "new", text: "merged", state: "valid" }],
  })
  const report = await applyPlan(client, mergePlan, ["merge-1"], { auditOnly: false })
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.kind), ["invalidate"])
  assert.match(report.results[0].detail, /resumed/)
})

test("merge aborts when a source changed", async () => {
  const client = mergeClient({ b: { id: "b", text: "rewritten", state: "valid" } })
  const report = await applyPlan(client, mergePlan, ["merge-1"], { auditOnly: false })
  assert.equal(report.results[0].status, "skipped")
  assert.deepEqual(client.calls, [])
})

test("edit rewrites the text only when the target is unchanged", async () => {
  const operation = { id: "edit-1", kind: "edit", memoryId: "a", reason: "fix", before: "text a", text: "corrected" }
  const plan = { ...mergePlan, operations: [operation] }
  const client = mergeClient()
  const report = await applyPlan(client, plan, ["edit-1"], { auditOnly: false })
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls, [{ kind: "edit", id: "a", text: "corrected" }])
})

test("verify checks a merge by its retained document and retired sources", async () => {
  const client = mergeClient({
    a: { id: "a", text: "text a", state: "invalidated" },
    b: { id: "b", text: "text b", state: "invalidated" },
    __retained: [{ id: "new", text: "merged", state: "valid" }],
  })
  const report = await verifyPlan(client, mergePlan, ["merge-1"])
  assert.equal(report.results[0].status, "applied")
  assert.match(report.results[0].detail, /sources retired: true/)
})

test("verify reports unknown operation IDs", async () => {
  const report = await verifyPlan(fakeClient(), plan, ["invalidate-a", "typo"])
  assert.equal(report.results.length, 2)
  assert.equal(report.results.find((result) => result.operationId === "typo")?.status, "unverified")
})

test("verify reports the observed state", async () => {
  const report = await verifyPlan(fakeClient({ a: { id: "a", text: "same text", state: "invalidated" } }), plan, ["invalidate-a"])
  assert.equal(report.results[0].status, "applied")
  assert.match(report.results[0].detail, /Observed state: invalidated/)
})
