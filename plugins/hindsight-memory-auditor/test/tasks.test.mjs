import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises"
import { join } from "node:path"
import { AuditTasks } from "../src/tasks.ts"
import { createTools } from "../src/tools.ts"
import { PlanStore } from "../src/plans.ts"

const fact = (id, extra = {}) => ({ id, text: `Full useful fact ${id} `.repeat(30), fact_type: "world", state: "valid", context: "dated project decision", ...extra })
const inventory = { bank: "bank", scanned: 2, valid: 2, invalidated: 0, truncated: false, changed: false, missingIds: [],
  complete: true, warnings: ["Observed, not atomic."], revision: "revision", memories: [fact("a"), fact("b")] }
const assignment = { check: "fragment", memoryIds: ["a"], referenceIds: ["b"], question: "Does this sentence carry a durable fact?", exclusions: "Only fragments on a; b is evidence only." }
const row = (id = "a", extra = {}) => ({
  memoryId: id, check: "fragment", status: "clean", verdict: "VERIFIED", claim: `Full useful fact ${id}`,
  evidence: `memory:${id}; context: dated project decision`, reason: "The sentence carries a complete durable decision.",
  confidence: "high", action: "keep", ...extra,
})
const context = (agent = "memory-auditor", sessionID = "primary") => ({
  sessionID, agent, id: "call", messageID: "message", signal: new AbortController().signal,
})

async function fixture(t) {
  const root = await mkdtemp("/tmp/opencode/auditor-task-")
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = new Map()
  const storage = { get: async (key) => state.get(key), set: async (key, value) => state.set(key, JSON.parse(JSON.stringify(value))) }
  let next = 0
  let tasks
  const messages = []
  const host = { session: {
    async create(input) { assert.equal(input.agent, "memory-auditor-worker"); return { id: `child-${++next}` } },
    async prompt(input) {
      assert.ok(await tasks.binding(input.sessionID), "binding must exist before the first prompt")
      messages.push(input)
    },
    async synthetic(input) { messages.push(input) },
  } }
  tasks = new AuditTasks(storage, host, root)
  await tasks.start("primary", inventory, ["fragment"])
  return { root, storage, tasks, host, messages }
}

test("worker is bound before prompting and accepted coverage survives a new store", async (t) => {
  const f = await fixture(t)
  const task = await f.tasks.assign("primary", assignment)
  assert.equal(task.childSessionID, "child-1")
  const before = await f.tasks.report("primary")
  assert.equal(before.complete, false)
  assert.equal(before.coverage[0].inspected, 0)
  await f.tasks.submit(task.childSessionID, task.id, [row()])
  const restored = new AuditTasks(f.storage, f.host, f.root)
  assert.equal((await restored.report("primary")).coverage[0].inspected, 1)
  assert.equal((await restored.report("primary")).complete, false, "b still needs its check")
  const second = await restored.assign("primary", { ...assignment, memoryIds: ["b"], referenceIds: [] })
  await restored.submit(second.childSessionID, second.id, [row("b")])
  assert.equal((await restored.report("primary")).complete, true)
})

test("scope, category and per-ID coverage errors reject the entire report", async (t) => {
  const f = await fixture(t)
  const task = await f.tasks.assign("primary", assignment)
  for (const rows of [[], [row("b")], [row(), row()], [row("a", { check: "duplicate" })],
    [row("a", { verdict: "DUPLICATE", status: "finding", action: "investigate" })],
    [row("a", { verdict: "UNVERIFIED", status: "finding", action: "invalidate" })],
    [row("a", { supportingMemoryIds: ["outside"] })]]) {
    await assert.rejects(f.tasks.submit(task.childSessionID, task.id, rows))
  }
  await assert.rejects(f.tasks.submit("other-session", task.id, [row()]), /bound/)
  assert.equal((await f.tasks.binding(task.childSessionID)).status, "running")
  assert.equal((await f.tasks.report("primary")).coverage[0].inspected, 0)
})

test("one active task, explicit cancellation and incomplete coverage", async (t) => {
  const f = await fixture(t)
  const task = await f.tasks.assign("primary", assignment)
  await assert.rejects(f.tasks.assign("primary", assignment), /active/)
  await assert.rejects(f.tasks.cancel("other-primary", task.id))
  await f.tasks.cancel("primary", task.id)
  assert.equal(await f.tasks.workerReadAllowed(await f.tasks.binding(task.childSessionID), "memory_auditor_inspect", { memoryId: "a" }), false)
  await assert.rejects(f.tasks.submit(task.childSessionID, task.id, [row()]))
  await f.tasks.assign("primary", assignment)
  assert.equal((await f.tasks.report("primary")).complete, false)
})

test("worker reads stay within target/reference IDs and granted real repository paths", async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.root, "allowed.md"), "Evidence\n")
  await writeFile(join(f.root, "other.md"), "Unassigned\n")
  await symlink("/etc/passwd", join(f.root, "escape"))
  const task = await f.tasks.assign("primary", { ...assignment, evidencePaths: ["allowed.md"] })
  assert.equal(await f.tasks.workerReadAllowed(task, "memory_auditor_inspect", { memoryId: "b" }), true)
  assert.equal(await f.tasks.workerReadAllowed(task, "memory_auditor_inspect", { memoryId: "outside" }), false)
  assert.equal(await f.tasks.workerReadAllowed(task, "read", { path: join(f.root, "allowed.md") }), true)
  for (const path of ["other.md", "escape", "/etc/passwd"]) {
    assert.equal(await f.tasks.workerReadAllowed(task, "read", { path }), false)
  }
  for (const tool of ["memory_auditor_apply", "memory_auditor_propose", "memory_auditor_inventory", "subagent", "execute", "memory_auditor_recall", "memory_auditor_git"]) {
    assert.equal(await f.tasks.workerReadAllowed(task, tool, {}), false)
  }
})

test("tool integration preserves full inventory, cumulative plans and fresh confirmation", async (t) => {
  const f = await fixture(t)
  const memories = new Map(inventory.memories.map((memory) => [memory.id, structuredClone(memory)]))
  const writes = []
  const confirmations = []
  let deny = false
  const client = {
    bank: "bank", withSignal() { return this },
    async inventory() { return structuredClone(inventory) },
    async getMemory(id) { return structuredClone(memories.get(id)) },
    async invalidate(id) { writes.push(id); memories.get(id).state = "invalidated" },
  }
  const plans = new PlanStore(f.storage)
  const tools = createTools(client, { apiUrl: "http://127.0.0.1:8890", bank: "bank" }, new Map(), f.root, plans, undefined, {
    tasks: f.tasks, approval: { async confirm(binding) { confirmations.push(binding); if (deny) throw new Error("denied") } },
  })
  const get = (name) => tools.find((tool) => tool.name === `memory_auditor_${name}`)
  const caller = context()
  const page = JSON.parse((await get("inventory").execute({ limit: 1, factType: "world" }, caller)).content)
  assert.equal(page.total, 2)
  assert.equal(page.nextOffset, 1)
  assert.equal(page.items[0].text, inventory.memories[0].text)
  assert.equal(page.items[0].context, inventory.memories[0].context)
  const first = JSON.parse((await get("propose").execute({ kind: "invalidate", memoryIds: ["a"], reason: "Verified exact noise" }, caller)).content)
  const second = JSON.parse((await get("propose").execute({ planId: first.id, kind: "invalidate", memoryIds: ["b"], reason: "Verified exact noise" }, caller)).content)
  assert.equal(second.operations.length, 2)
  assert.notEqual(first.hash, second.hash)
  assert.equal(JSON.parse((await get("preview").execute({ planId: second.id }, caller)).content).hash, second.hash)
  await get("scan").execute({ checks: ["fragment"] }, caller)
  assert.ok(await plans.load("primary", first.id), "rescanning must not clear existing plans")
  const applyInput = { planId: second.id, operationIds: [second.operations[0].id] }
  await assert.rejects(get("apply").execute(applyInput, { sessionID: "primary" }), /Native/)
  await assert.rejects(get("apply").execute({ ...applyInput, operationIds: [second.operations[0].id, "unknown"] }, caller), /known/)
  assert.equal(confirmations.length, 0)
  deny = true
  await assert.rejects(get("apply").execute(applyInput, caller), /denied/)
  assert.deepEqual(writes, [])
  deny = false
  const applied = await get("apply").execute(applyInput, caller)
  assert.match(applied.content, /applied/)
  assert.deepEqual(writes, ["a"])
  assert.equal(confirmations.length, 2, "each attempt requests confirmation")
  assert.equal(confirmations[1].planHash, second.hash)
  assert.deepEqual(confirmations[1].operationIds, applyInput.operationIds)
})

test("bound worker cannot gain writes by claiming the primary agent identity", async (t) => {
  const f = await fixture(t)
  const task = await f.tasks.assign("primary", assignment)
  const client = { bank: "bank" }
  const tools = createTools(client, { apiUrl: "http://127.0.0.1:8890" }, new Map(), f.root, new PlanStore(f.storage), undefined,
    { tasks: f.tasks, approval: { confirm() { throw new Error("must not reach approval") } } })
  for (const name of ["apply", "propose", "assign", "inventory"]) {
    const tool = tools.find((tool) => tool.name === `memory_auditor_${name}`)
    await assert.rejects(tool.execute({}, context("memory-auditor", task.childSessionID)), /outside/)
  }
})

test("accepted worker findings produce a deterministic escaped Markdown table", async (t) => {
  const f = await fixture(t)
  const text = "Agent read file | `x` [label]"
  await f.tasks.start("primary", { ...inventory, memories: [fact("a", { text }), fact("b")] }, ["fragment"])
  const task = await f.tasks.assign("primary", assignment)
  const tools = createTools({ bank: "bank" }, { apiUrl: "http://127.0.0.1:8890" }, new Map(), f.root, new PlanStore(f.storage), undefined,
    { tasks: f.tasks, approval: {} })
  const result = await tools.find((tool) => tool.name === "memory_auditor_submit").execute({
    taskId: task.id, rows: [row("a", { claim: text, status: "finding", verdict: "LOW_SIGNAL", action: "investigate" })],
  }, context("memory-auditor-worker", task.childSessionID))
  assert.match(result.content, /\| Task \| Memory ID \| Check \|/)
  assert.ok(result.content.includes("Agent read file \\| \\`x\\` \\[label\\]"))
  assert.match(result.content, /findings=1, clean=0, blocked=0, incomplete=0/)
})
