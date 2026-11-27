import assert from "node:assert/strict"
import { test } from "node:test"
import { HindsightClient } from "../src/hindsight.ts"
import { resolveConfig, assertBank } from "../src/config.ts"

const config = { apiUrl: "http://hindsight.test:8890", bank: "bank::x", auditOnly: true, pageSize: 2, maxMemories: 10 }

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
          ? [{ id: "a", text: "one" }, { id: "b", text: "two" }]
          : offset === 2
            ? [{ id: "c", text: "three" }]
            : []
      return [200, { items }]
    },
  }
  const client = new HindsightClient(config, fakeFetch(pages))
  const inventory = await client.inventory()
  assert.equal(inventory.scanned, 3)
  assert.equal(inventory.valid, 3)
  assert.equal(inventory.truncated, false)
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

test("client surfaces HTTP failures with status and detail", async () => {
  const client = new HindsightClient(config, fakeFetch({ "*": () => [500, { detail: "boom" }] }))
  await assert.rejects(() => client.getMemory("abc"), /500.*boom/s)
})

test("resolveConfig requires an explicit bank and rejects other schemes", () => {
  assert.throws(() => resolveConfig({}, {}), /bank must be configured/)
  assert.equal(resolveConfig({}, { HINDSIGHT_BANK_ID: "b" }).bank, "b")
  assert.throws(() => resolveConfig({ apiUrl: "ftp://x", bank: "b" }, {}), /http or https/)
  assert.equal(resolveConfig({ bank: "b" }, {}).auditOnly, true)
  assert.equal(resolveConfig({ bank: "b", auditOnly: false }, {}).auditOnly, false)
})

test("a bearer token is refused over non-loopback http", () => {
  assert.throws(() => resolveConfig({ apiUrl: "http://hindsight.example:8890", bank: "b", token: "t" }, {}), /bearer token requires https/)
  assert.equal(resolveConfig({ apiUrl: "http://127.0.0.1:8890", bank: "b", token: "t" }, {}).token, "t")
  assert.equal(resolveConfig({ apiUrl: "https://hindsight.example", bank: "b", token: "t" }, {}).token, "t")
})

test("assertBank refuses a different bank", () => {
  assert.equal(assertBank("b", "b"), "b")
  assert.throws(() => assertBank("b", "other"), /Refusing to touch bank other/)
})
