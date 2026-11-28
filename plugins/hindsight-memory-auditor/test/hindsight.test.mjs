import assert from "node:assert/strict"
import { test } from "node:test"
import { HindsightClient } from "../src/hindsight.ts"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, assertBank, expandBankTemplate } from "../src/config.ts"

const config = { apiUrl: "http://hindsight.test:8890", bank: "bank::x", pageSize: 2, maxMemories: 10, requestTimeoutMs: 15000 }

function fakeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search
    calls.push({ path, method: init.method ?? "GET", body: init.body })
    const handler = routes[path.split("?")[0]] ?? routes["*"]
    if (!handler) return new Response("missing", { status: 404 })
    const [status, payload] = handler({ path, init })
    return new Response(JSON.stringify(payload), { status })
  }
  impl.calls = calls
  return impl
}

test("inventory paginates until a short page arrives", async () => {
  const pages = {
    "/v1/default/banks/bank%3A%3Ax/memories/list": ({ path }) => {
      const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset"))
      const items =
        offset === 0
          ? [{ id: "a", text: "one", updated_at: "2026-11-27" }, { id: "b", text: "two", updated_at: "2026-11-27" }]
          : offset === 2
            ? [{ id: "c", text: "three" }]
            : []
      return [200, { items }]
    },
    "*": ({ path }) => {
      const id = path.split("/").at(-1)
      return [200, { id, text: { a: "one", b: "two", c: "three" }[id], type: "world", state: "valid", context: "full context" }]
    },
  }
  const client = new HindsightClient(config, fakeFetch(pages))
  const inventory = await client.inventory()
  assert.equal(inventory.scanned, 3)
  assert.equal(inventory.valid, 3)
  assert.equal(inventory.truncated, false)
  assert.equal(inventory.complete, true)
  assert.equal(inventory.changed, false, "missing detail timestamps do not prove a changed memory")
  assert.ok(inventory.warnings.some((warning) => warning.includes("timestamps")))
  assert.equal(inventory.memories[0].context, "full context")
})

test("inventory marks truncation at maxMemories", async () => {
  const many = Array.from({ length: 2 }, (_, index) => ({ id: `m${index}`, text: `t${index}` }))
  const client = new HindsightClient({ ...config, maxMemories: 2 }, fakeFetch({ "*": () => [200, { items: many }] }))
  const inventory = await client.inventory()
  assert.equal(inventory.scanned, 2)
  assert.equal(inventory.truncated, true)
})

test("invalidate PATCHes the fixed bank with the configured route", async () => {
  const fetchImpl = fakeFetch({ "/v1/default/banks/bank%3A%3Ax/memories/abc": () => [200, { id: "abc", text: "t", state: "invalidated" }] })
  const client = new HindsightClient(config, fetchImpl)
  await client.invalidate("abc", "duplicate")
  assert.equal(fetchImpl.calls[0].method, "PATCH")
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].body), { state: "invalidated", reason: "duplicate" })
})

test("recall posts the query and trims the results", async () => {
  const fetchImpl = fakeFetch({ "/v1/default/banks/bank%3A%3Ax/memories/recall": () => [200, { results: [{ id: "a", text: "one" }, { id: "b", text: "two" }] }] })
  const client = new HindsightClient(config, fetchImpl)
  const results = await client.recall("injection", 1)
  assert.equal(results.length, 1)
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].body), { query: "injection" })
  assert.equal(fetchImpl.calls[0].method, "POST")
})

test("entities pages the bank entity list", async () => {
  const fetchImpl = fakeFetch({ "/v1/default/banks/bank%3A%3Ax/entities": () => [200, { items: [{ id: "e", canonical_name: "plugin", mention_count: 3 }], total: 1 }] })
  const client = new HindsightClient(config, fetchImpl)
  const page = await client.entities({ limit: 10, offset: 0 })
  assert.equal(page.total, 1)
  assert.equal(page.items[0].canonical_name, "plugin")
  assert.match(fetchImpl.calls[0].path, /limit=10/)
})

test("inventory pages the raw units with an offset", async () => {
  const fetchImpl = fakeFetch({ "/v1/default/banks/bank%3A%3Ax/memories/list": () => [200, { items: [{ id: "a", text: "one", fact_type: "world" }], total: 9 }] })
  const client = new HindsightClient(config, fetchImpl)
  const page = await client.listMemories({ limit: 5, offset: 10 })
  assert.equal(page.total, 9)
  assert.match(fetchImpl.calls[0].path, /offset=10/)
})

test("client surfaces HTTP status without leaking response bodies", async () => {
  const client = new HindsightClient(config, fakeFetch({ "*": () => [500, { detail: "boom" }] }))
  await assert.rejects(() => client.getMemory("abc"), (error) => /500/.test(error.message) && !error.message.includes("boom"))
})

const noIntegration = "/tmp/opencode/does-not-exist-coding-agent.json"

test("resolveConfig requires a bank when nothing can be resolved", () => {
  assert.throws(() => resolveConfig({}, {}, undefined, noIntegration), /No Hindsight bank/)
  assert.equal(resolveConfig({}, { HINDSIGHT_BANK_ID: "b" }, undefined, noIntegration).bank, "b")
  assert.throws(() => resolveConfig({ apiUrl: "ftp://x", bank: "b" }, {}, undefined, noIntegration), /http or https/)
  assert.equal("auditOnly" in resolveConfig({ bank: "b" }, {}, undefined, noIntegration), false)
})

test("resolveConfig expands the integration bank template for the project", () => {
  const dir = mkdtempSync(join(tmpdir(), "coding-agents-"))
  const path = join(dir, "coding-agent.json")
  writeFileSync(path, JSON.stringify({ apiUrl: "http://127.0.0.1:8890", bankIdTemplate: "coding-agent::host::{gitProject}" }))
  const config = resolveConfig({}, {}, "dev", path)
  assert.equal(config.bank, "coding-agent::host::dev")
  assert.equal(config.apiUrl, "http://127.0.0.1:8890")
  assert.throws(() => resolveConfig({}, {}, "dev", noIntegration), /No Hindsight bank/)
})

test("expandBankTemplate refuses unknown placeholders", () => {
  assert.throws(() => expandBankTemplate("bank::{workspace}", "dev"), /Unsupported bankIdTemplate/)
  assert.throws(() => expandBankTemplate("bank::{workspace_id}", "dev"), /Unsupported bankIdTemplate/)
  assert.throws(() => expandBankTemplate("bank::{2fa}", "dev"), /Unsupported bankIdTemplate/)
})

test("expandBankTemplate inserts the project name literally", () => {
  assert.equal(expandBankTemplate("bank::{gitProject}", "$&"), "bank::$&")
  assert.equal(expandBankTemplate("bank::{gitProject}", "dev"), "bank::dev")
})

test("banks() requests the bank list endpoint, not the server root", async () => {
  const fetchImpl = fakeFetch({ "/v1/default/banks": () => [200, { banks: [{ bank_id: "bank::x" }] }] })
  const client = new HindsightClient(config, fetchImpl)
  assert.deepEqual(await client.banks(), ["bank::x"])
  assert.equal(fetchImpl.calls[0].path, "/v1/default/banks")
})

test("a bearer token is refused over non-loopback http", () => {
  assert.throws(() => resolveConfig({ apiUrl: "http://hindsight.example:8890", bank: "b", token: "t" }, {}), /bearer token requires https/)
  assert.equal(resolveConfig({ apiUrl: "http://127.0.0.1:8890", bank: "b", token: "t" }, {}).token, "t")
  assert.equal(resolveConfig({ apiUrl: "https://hindsight.example", bank: "b", token: "t" }, {}).token, "t")
})

test("a contradictory total at the safety cap is not reported complete", async () => {
  const many = [{ id: "a", text: "one" }, { id: "b", text: "two" }]
  const client = new HindsightClient({ ...config, maxMemories: 2 }, fakeFetch({ "*": () => [200, { items: many, total: 1 }] }))
  const inventory = await client.inventory()
  assert.equal(inventory.scanned, 2)
  assert.equal(inventory.changed, true)
  assert.equal(inventory.complete, false)
})

test("assertBank refuses a different bank", () => {
  assert.equal(assertBank("b", "b"), "b")
  assert.throws(() => assertBank("b", "other"), /Refusing to touch bank other/)
})

test("detail normalizes type and preserves provenance, history and complete text", async () => {
  const text = "verified claim ".repeat(100)
  const memory = { id: "a", text, type: "world", state: "valid", source_memory_ids: ["s"], history: [{ reason: "source" }], context: "dated" }
  const client = new HindsightClient(config, fakeFetch({ "*": () => [200, memory] }))
  const result = await client.getMemory("a")
  assert.equal(result.fact_type, "world")
  assert.equal(result.text, text)
  assert.deepEqual(result.history, memory.history)
  await assert.rejects(client.getMemory("wrong-id"), /identity/)
})

test("inventory flags repeated IDs and unavailable details instead of counting duplicates", async () => {
  const client = new HindsightClient(config, fakeFetch({
    "*": ({ path }) => path.includes("/list?")
      ? [200, { items: new URLSearchParams(path.split("?")[1]).get("offset") === "0"
        ? [{ id: "a", text: "one" }, { id: "a", text: "one" }] : [] }]
      : [404, {}],
  }))
  const result = await client.inventory()
  assert.equal(result.scanned, 1)
  assert.equal(result.changed, true)
  assert.equal(result.complete, false)
  assert.deepEqual(result.missingIds, ["a"])
})

test("server filtering uses type before pagination", async () => {
  const impl = fakeFetch({ "*": () => [200, { items: [], total: 0 }] })
  await new HindsightClient(config, impl).listMemories({ limit: 2, offset: 4, factType: "experience" })
  assert.match(impl.calls[0].path, /type=experience/)
  assert.match(impl.calls[0].path, /offset=4/)
})

test("cancellation and timeout include stalled response body reads", async () => {
  const stalled = async () => ({ ok: true, json: () => new Promise(() => {}) })
  const controller = new AbortController()
  const pending = new HindsightClient(config, stalled).withSignal(controller.signal).getMemory("a")
  controller.abort()
  await assert.rejects(pending)
  const keepAlive = setTimeout(() => {}, 100)
  try {
    await assert.rejects(new HindsightClient({ ...config, requestTimeoutMs: 5 }, stalled).getMemory("a"), /timeout/i)
  } finally { clearTimeout(keepAlive) }
})
