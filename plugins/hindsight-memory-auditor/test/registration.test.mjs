import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createTools } from "../src/tools.ts"
import { PlanStore } from "../src/plans.ts"

const client = { bank: "bank", banks: async () => ["bank"] }
const config = { apiUrl: "http://127.0.0.1:8890", bank: "bank", pageSize: 10, maxMemories: 10, requestTimeoutMs: 15000 }
const storage = { get: async () => undefined, set: async () => {} }

test("every auditor tool is registered directly, not behind Code Mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-"))
  const tools = createTools(client, config, new Map(), root, new PlanStore(storage))
  assert.equal(tools.length, 15)
  for (const tool of tools) {
    assert.equal(tool.options?.codemode, false, `${tool.name} must be a direct tool`)
  }
})

test("tool names are unique and prefixed", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-"))
  const names = createTools(client, config, new Map(), root, new PlanStore(storage)).map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
  for (const name of names) assert.match(name, /^memory_auditor_[a-z]+$/)
})
