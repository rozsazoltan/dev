import assert from "node:assert/strict"
import { test } from "node:test"
import { applyPlan, verifyPlan } from "../src/executor.ts"
import { packPlan } from "../src/audit.ts"

const fact = (id, text = "same text", extra = {}) => ({ id, text, state: "valid", fact_type: "world", ...extra })
const plan = packPlan("bank", [], [
    { id: "invalidate-a", kind: "invalidate", memoryId: "a", reason: "duplicate", before: "same text", beforeSnapshot: fact("a") },
    { id: "invalidate-b", kind: "invalidate", memoryId: "b", reason: "duplicate", before: "older text", beforeSnapshot: fact("b", "older text") },
])

function fakeClient(overrides = {}) {
  const calls = []
  const memories = { a: fact("a"), b: fact("b", "older text"), ...structuredClone(overrides) }
  return {
    calls,
    bank: "bank",
    async getMemory(id) {
      return structuredClone(memories[id] ?? fact(id))
    },
    async invalidate(id, reason) {
      calls.push({ id, reason })
      memories[id] = { ...(memories[id] ?? fact(id)), state: "invalidated" }
    },
    async restore(id, reason) {
      calls.push({ id, reason })
      memories[id] = { ...(memories[id] ?? fact(id)), state: "valid" }
    },
  }
}

test("only approved operations run", async () => {
  const client = fakeClient()
  const report = await applyPlan(client, plan, ["invalidate-a"])
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.id), ["a"])
})

test("a target that changed after planning rejects the whole selection", async () => {
  const client = fakeClient({ a: fact("a", "edited later") })
  await assert.rejects(applyPlan(client, plan, ["invalidate-a"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("an already invalidated target requires a new explicit plan", async () => {
  const client = fakeClient({ a: fact("a", "same text", { state: "invalidated" }) })
  await assert.rejects(applyPlan(client, plan, ["invalidate-a"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("known and unknown operation IDs together produce zero writes", async () => {
  const client = fakeClient()
  await assert.rejects(applyPlan(client, plan, ["invalidate-a", "nope"]), /unknown/)
  assert.deepEqual(client.calls, [])
})

test("a duplicate is skipped when its keeper is no longer valid", async () => {
  const client = fakeClient({ a: fact("a"), keeper: fact("keeper", "same text", { state: "invalidated" }) })
  const guarded = packPlan("bank", [], [{ ...plan.operations[0], keep: "keeper", keepBefore: "same text", keeperSnapshot: fact("keeper") }])
  await assert.rejects(applyPlan(client, guarded, ["invalidate-a"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("a duplicate is skipped when its keeper changed", async () => {
  const client = fakeClient({ a: fact("a"), keeper: fact("keeper", "rewritten") })
  const guarded = packPlan("bank", [], [{ ...plan.operations[0], keep: "keeper", keepBefore: "same text", keeperSnapshot: fact("keeper") }])
  await assert.rejects(applyPlan(client, guarded, ["invalidate-a"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("a plan from another bank is refused", async () => {
  const client = { ...fakeClient(), bank: "other" }
  await assert.rejects(() => applyPlan(client, plan, ["invalidate-a"]), /belongs to bank bank/)
})

function mergeClient(overrides = {}) {
  const calls = []
  const memories = { a: fact("a", "text a"), b: fact("b", "text b"), ...structuredClone(overrides) }
  let retained = overrides.__retained ?? []
  return {
    calls,
    bank: "bank",
    async getMemory(id) {
      return structuredClone(memories[id] ?? fact(id, `text ${id}`))
    },
    async retain(item) {
      calls.push({ kind: "retain", item })
      retained = [{ id: "new", text: item.content, context: item.context, document_id: item.documentId, fact_type: "world", state: "valid" }]
    },
    async invalidate(id, reason) {
      calls.push({ kind: "invalidate", id, reason })
      memories[id].state = "invalidated"
    },
    async updateText(id, text) {
      calls.push({ kind: "edit", id, text })
      memories[id].text = text
    },
    async byDocument(documentId) {
      return structuredClone(retained)
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
    { id: "a", text: "text a", snapshot: fact("a", "text a") },
    { id: "b", text: "text b", snapshot: fact("b", "text b") },
  ],
  text: "merged fact",
  documentId: "memory-auditor-merge-1",
}
const mergePlan = packPlan("bank", [], [mergeOperation])

test("merge retains the new text and retires every source", async () => {
  const client = mergeClient()
  const report = await applyPlan(client, mergePlan, ["merge-1"])
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.kind), ["retain", "invalidate", "invalidate"])
  assert.equal(client.calls[0].item.content, "merged fact")
  assert.equal(client.calls[0].item.documentId, "memory-auditor-merge-1")
})

test("merge refuses inferred retries when a source is already retired", async () => {
  const client = mergeClient({
    a: { id: "a", text: "text a", state: "invalidated", fact_type: "world" },
    __retained: [{ id: "new", text: "merged", state: "valid" }],
  })
  await assert.rejects(applyPlan(client, mergePlan, ["merge-1"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("merge aborts on resume when a retired source was edited", async () => {
  const client = mergeClient({
    a: { id: "a", text: "edited after retirement", state: "invalidated" },
    __retained: [{ id: "new", text: "merged", state: "valid" }],
  })
  await assert.rejects(applyPlan(client, mergePlan, ["merge-1"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("merge aborts when a source changed", async () => {
  const client = mergeClient({ b: { id: "b", text: "rewritten", state: "valid" } })
  await assert.rejects(applyPlan(client, mergePlan, ["merge-1"]), /Preflight/)
  assert.deepEqual(client.calls, [])
})

test("edit rewrites the text only when the target is unchanged", async () => {
  const operation = { id: "edit-1", kind: "edit", memoryId: "a", reason: "fix", before: "text a", text: "corrected", beforeSnapshot: fact("a", "text a") }
  const plan = packPlan("bank", [], [operation])
  const client = mergeClient()
  const report = await applyPlan(client, plan, ["edit-1"])
  assert.equal(report.results[0].status, "applied")
  assert.deepEqual(client.calls, [{ kind: "edit", id: "a", text: "corrected" }])
})

test("verify checks a merge by its retained document and retired sources", async () => {
  const client = mergeClient({
    a: fact("a", "text a", { state: "invalidated" }),
    b: fact("b", "text b", { state: "invalidated" }),
    __retained: [fact("new", "merged fact", { document_id: mergeOperation.documentId })],
  })
  const report = await verifyPlan(client, mergePlan, ["merge-1"])
  assert.equal(report.results[0].status, "applied")
  assert.match(report.results[0].detail, /sources retired: true/)
})

test("verify reports unknown operation IDs", async () => {
  await assert.rejects(verifyPlan(fakeClient(), plan, ["invalidate-a", "typo"]), /known/)
})

test("verify reports the observed state", async () => {
  const report = await verifyPlan(fakeClient({ a: fact("a", "same text", { state: "invalidated" }) }), plan, ["invalidate-a"])
  assert.equal(report.results[0].status, "applied")
  assert.match(report.results[0].detail, /Observed state: invalidated/)
})

test("restore actually restores an invalidated source fact and verifies it", async () => {
  const before = fact("a", "same text", { state: "invalidated", context: "original context" })
  const operation = { id: "restore-a", kind: "restore", memoryId: "a", before: before.text, beforeSnapshot: before, reason: "recover" }
  const recovery = packPlan("bank", [], [operation])
  const client = fakeClient({ a: before })
  assert.equal((await applyPlan(client, recovery, ["restore-a"])).results[0].status, "applied")
  assert.equal((await verifyPlan(client, recovery, ["restore-a"])).results[0].status, "applied")
  assert.deepEqual(client.calls.map((call) => call.id), ["a"])
})

test("unknown types, observations and empty/duplicate selections never write", async () => {
  for (const fact_type of ["observation", undefined]) {
    const before = fact("a", "same text", { fact_type })
    const client = fakeClient({ a: before })
    const scoped = packPlan("bank", [], [{ ...plan.operations[0], beforeSnapshot: before }])
    await assert.rejects(applyPlan(client, scoped, ["invalidate-a"]), /Preflight/)
    assert.deepEqual(client.calls, [])
  }
  for (const ids of [[], ["invalidate-a", "invalidate-a"]]) {
    const client = fakeClient()
    await assert.rejects(applyPlan(client, plan, ids), /unique/)
    assert.deepEqual(client.calls, [])
  }
})

test("several duplicate retirements can share one unchanged keeper", async () => {
  const before = fact("a")
  const second = fact("b")
  const keeper = fact("keeper")
  const operations = [before, second].map((memory) => ({
    id: `retire-${memory.id}`, kind: "invalidate", memoryId: memory.id, before: memory.text, beforeSnapshot: memory,
    keep: keeper.id, keepBefore: keeper.text, keeperSnapshot: keeper, reason: "same fully scoped fact",
  }))
  const scoped = packPlan("bank", [], operations)
  const client = fakeClient({ a: before, b: second, keeper })
  const results = await applyPlan(client, scoped, operations.map((operation) => operation.id))
  assert.deepEqual(results.results.map((result) => result.status), ["applied", "applied"])
})

test("context changes immediately before mutation stop writes", async () => {
  const client = fakeClient()
  const original = client.getMemory
  let reads = 0
  client.getMemory = async (id) => {
    const memory = await original(id)
    return ++reads > 1 ? { ...memory, context: "changed after preflight" } : memory
  }
  const result = await applyPlan(client, plan, ["invalidate-a"])
  assert.equal(result.results[0].status, "skipped")
  assert.deepEqual(client.calls, [])
})

test("missing or unrelated retained replacement never retires merge sources", async () => {
  for (const wrong of [[], [fact("new", "unrelated", { document_id: mergeOperation.documentId })]]) {
    const client = mergeClient()
    let retained = false
    client.retain = async () => { retained = true; client.calls.push({ kind: "retain" }) }
    client.byDocument = async () => retained ? wrong : []
    const result = await applyPlan(client, mergePlan, ["merge-1"])
    assert.equal(result.results[0].status, "unverified")
    assert.deepEqual(client.calls.map((call) => call.kind), ["retain"])
    assert.equal((await client.getMemory("a")).state, "valid")
    assert.equal((await client.getMemory("b")).state, "valid")
  }
})

test("preexisting merge document blocks every selected operation before writes", async () => {
  const client = mergeClient({ __retained: [fact("new", "merged fact", { document_id: mergeOperation.documentId })] })
  const report = await applyPlan(client, mergePlan, ["merge-1"])
  assert.equal(report.results[0].status, "unverified")
  assert.deepEqual(client.calls, [])
})

test("partial merge failure does not grant an inferred retry", async () => {
  const client = mergeClient()
  const invalidate = client.invalidate
  client.invalidate = async (id, reason) => { if (id === "b") throw new Error("injected failure"); await invalidate(id, reason) }
  const result = await applyPlan(client, mergePlan, ["merge-1"])
  assert.equal(result.results[0].status, "failed")
  assert.equal((await client.getMemory("a")).state, "invalidated")
  const count = client.calls.length
  await assert.rejects(applyPlan(client, mergePlan, ["merge-1"]), /Preflight/)
  assert.equal(client.calls.length, count)
})

test("verification rejects unrelated replacement, altered keeper and tampered plan", async () => {
  const merged = mergeClient({
    a: fact("a", "text a", { state: "invalidated" }), b: fact("b", "text b", { state: "invalidated" }),
    __retained: [fact("new", "wrong", { document_id: mergeOperation.documentId })],
  })
  assert.equal((await verifyPlan(merged, mergePlan, ["merge-1"])).results[0].status, "unverified")
  const guarded = packPlan("bank", [], [{ ...plan.operations[0], keep: "keeper", keepBefore: "same text", keeperSnapshot: fact("keeper") }])
  assert.equal((await verifyPlan(fakeClient({ a: fact("a", "same text", { state: "invalidated" }), keeper: fact("keeper", "changed") }), guarded, ["invalidate-a"])).results[0].status, "unverified")
  await assert.rejects(verifyPlan(fakeClient(), { ...plan, bank: "changed" }, ["invalidate-a"]))
})

test("replacement loss during the final source retirement is never reported applied", async () => {
  const client = mergeClient()
  const invalidate = client.invalidate
  const byDocument = client.byDocument
  let lost = false
  client.invalidate = async (id, reason) => { await invalidate(id, reason); if (id === "b") lost = true }
  client.byDocument = async (id) => lost ? [] : byDocument(id)
  const result = await applyPlan(client, mergePlan, ["merge-1"])
  assert.equal(result.results[0].status, "unverified")
})
