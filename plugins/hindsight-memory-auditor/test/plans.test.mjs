import assert from "node:assert/strict"
import { test } from "node:test"
import { createGitEvidence } from "../src/evidence.ts"
import { PlanStore } from "../src/plans.ts"

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

const plan = (id) => ({ id, hash: id, bank: "b", createdAt: "now", findings: [], operations: [] })

test("plans survive a new store instance over the same storage", async () => {
  const storage = fakeStorage()
  await new PlanStore(storage).save("s1", plan("p1"))
  const loaded = await new PlanStore(storage).load("s1", "p1")
  assert.equal(loaded?.id, "p1")
})

test("the store keeps only the last five plans", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  for (const id of ["a", "b", "c", "d", "e", "f"]) await store.save("s1", plan(id))
  const keys = Object.keys(storage.data.get("hindsight-memory-auditor.plans.s1"))
  assert.deepEqual(keys.sort(), ["b", "c", "d", "e", "f"])
})

test("re-saving a plan refreshes its retention position", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  for (const id of ["a", "b", "c", "d", "e"]) await store.save("s", plan(id))
  await store.save("s", plan("a"))
  await store.save("s", plan("f"))
  const keys = Object.keys(storage.data.get("hindsight-memory-auditor.plans.s"))
  assert.deepEqual(keys.sort(), ["a", "c", "d", "e", "f"])
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
  const saving = store.save("s", plan("p"))
  const clearing = store.clear("s")
  release()
  await Promise.all([saving, clearing])
  assert.equal(await store.load("s", "p"), undefined)
})

test("a missing or corrupt entry yields no plan", async () => {
  const storage = fakeStorage()
  storage.data.set("hindsight-memory-auditor.plans.s1", "not-an-object")
  assert.equal(await new PlanStore(storage).load("s1", "x"), undefined)
})

test("sessions do not see or clear each other's plans", async () => {
  const storage = fakeStorage()
  const store = new PlanStore(storage)
  await store.save("a", plan("pa"))
  await store.save("b", plan("pb"))
  await store.clear("a")
  assert.equal(await store.load("a", "pa"), undefined)
  assert.equal((await store.load("b", "pb"))?.id, "pb")
})
