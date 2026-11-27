import assert from "node:assert/strict"
import { test } from "node:test"
import { createGitEvidence } from "../src/evidence.ts"
import { PlanStore } from "../src/plans.ts"
import { packPlan } from "../src/audit.ts"

test("git evidence stays read-only and bounded", async () => {
  const calls = []
  const vcs = {
    async get(input) {
      calls.push(["get", input])
      return { data: { branch: "feat/x", head: "abc123" } }
    },
    async status(input) {
      calls.push(["status", input])
      return { data: [{ path: "a.ts", status: "modified" }] }
    },
    async diff(input) {
      calls.push(["diff", input])
      return { data: Array.from({ length: 200 }, () => "line").join("\n") }
    },
  }
  const git = createGitEvidence(vcs, "/repo")
  assert.match(await git.info(), /feat\/x/)
  assert.match(await git.status(), /a\.ts/)
  const diff = await git.diff("working")
  assert.ok(diff.length <= 6001)
  assert.deepEqual(calls[0], ["get", { location: { directory: "/repo" } }])
  assert.deepEqual(calls[2][1], { location: { directory: "/repo" }, mode: "working" })
})

function fakeStorage() {
  const data = new Map()
  return {
    data,
    async get(key) {
      return data.get(key)
    },
    async set(key, value) {
      data.set(key, value)
    },
  }
}

const plan = (label) => packPlan("b", [], [{ id: `op-${label}`, kind: "invalidate", memoryId: `m-${label}`, reason: "test", before: "text" }])

test("plans survive a new store instance over the same storage", async () => {
  const storage = fakeStorage()
  const saved = plan("p1")
  await new PlanStore(storage).save("s1", saved)
  const loaded = await new PlanStore(storage).load("s1", saved.id)
  assert.equal(loaded?.id, saved.id)
})

test("the store preserves all plans", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  const saved = await Promise.all(["a", "b", "c", "d", "e", "f"].map((id) => store.save("s1", plan(id))))
  const keys = Object.keys(storage.data.get("hindsight-memory-auditor.plans.s1"))
  assert.equal(keys.length, 6)
})

test("re-saving an immutable plan is idempotent without evicting other plans", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  const a = plan("a")
  for (const id of ["a", "b", "c", "d", "e"]) await store.save("s", plan(id))
  await store.save("s", a)
  await store.save("s", plan("f"))
  const keys = Object.keys(storage.data.get("hindsight-memory-auditor.plans.s"))
  assert.equal(keys.length, 6)
})

test("JSON storage preserves full plan integrity and input/output snapshots are isolated", async () => {
  const data = new Map()
  const storage = {
    get: async (key) => data.get(key),
    set: async (key, value) => data.set(key, JSON.parse(JSON.stringify(value))),
  }
  const store = new PlanStore(storage)
  const initial = packPlan("bank", [], [{ id: "op", kind: "edit", memoryId: "m", reason: "verified", before: "old", text: "new", context: undefined }])
  const id = initial.id
  const pending = store.save("s", initial)
  initial.operations[0].text = "tampered during pending save"
  await pending
  const loaded = await store.load("s", id)
  assert.equal(loaded.operations[0].text, "new")
  loaded.operations[0].text = "tampered after load"
  assert.equal((await store.load("s", id)).operations[0].text, "new")
})

test("a valid plan stored under another key is not returned", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  const stored = plan("real")
  await store.save("s", stored)
  const data = storage.data.get("hindsight-memory-auditor.plans.s")
  storage.data.set("hindsight-memory-auditor.plans.s", { "wrong-key": data[stored.id] })
  assert.equal(await store.load("s", "wrong-key"), undefined)
})

test("a clear cannot land inside a pending save", async () => {
  const data = new Map()
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const storage = {
    async get(key) {
      return data.get(key)
    },
    async set(key, value) {
      await gate
      data.set(key, value)
    },
  }
  const store = new PlanStore(storage)
  const savedPlan = plan("p")
  const saving = store.save("s", savedPlan)
  const clearing = store.clear("s")
  release()
  await Promise.all([saving, clearing])
  assert.equal(await store.load("s", savedPlan.id), undefined)
})

test("a missing or corrupt entry yields no plan", async () => {
  const storage = fakeStorage()
  storage.data.set("hindsight-memory-auditor.plans.s1", "not-an-object")
  assert.equal(await new PlanStore(storage).load("s1", "x"), undefined)
})

test("sessions do not see or clear each other's plans", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  const pa = plan("pa")
  const pb = plan("pb")
  await store.save("a", pa)
  await store.save("b", pb)
  await store.clear("a")
  assert.equal(await store.load("a", pa.id), undefined)
  assert.equal((await store.load("b", pb.id))?.id, pb.id)
})
