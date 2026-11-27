import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { buildPlan, scan } from "../src/audit.ts"
import { applyPlan } from "../src/executor.ts"
import { HindsightClient } from "../src/hindsight.ts"

/** Minimal Hindsight stand-in: list, get and PATCH state over the real HTTP client. */
async function server(memories) {
  const state = new Map(memories.map((memory) => [memory.id, { ...memory }]))
  const http = createServer((request, response) => {
    const url = new URL(request.url, "http://local")
    const bank = decodeURIComponent(url.pathname.split("/")[4] ?? "")
    const send = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(payload))
    }
    if (bank !== "bank::test") return send(404, { detail: "wrong bank" })
    if (request.method === "GET" && url.pathname.endsWith("/memories/list")) {
      const limit = Number(url.searchParams.get("limit") ?? "100")
      const offset = Number(url.searchParams.get("offset") ?? "0")
      return send(200, { items: [...state.values()].slice(offset, offset + limit) })
    }
    const match = /\/memories\/([^/]+)$/.exec(url.pathname)
    if (match) {
      const id = decodeURIComponent(match[1])
      const memory = state.get(id)
      if (!memory) return send(404, { detail: "missing" })
      if (request.method === "GET") return send(200, memory)
      if (request.method === "PATCH") {
        let body = ""
        request.on("data", (chunk) => (body += chunk))
        request.on("end", () => {
          const patch = JSON.parse(body || "{}")
          Object.assign(memory, patch.state ? { state: patch.state, invalidation_reason: patch.reason ?? null } : {})
          send(200, memory)
        })
        return
      }
    }
    send(405, { detail: "method not allowed" })
  })
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve))
  const { port } = http.address()
  return { client: new HindsightClient({ apiUrl: `http://127.0.0.1:${port}`, bank: "bank::test", auditOnly: false, pageSize: 2, maxMemories: 50 }), close: () => http.close() }
}

test("end to end: scan the fake bank, approve one operation, verify the state", async () => {
  const { client, close } = await server([
    { id: "a", text: "The preset pins commit 305e335.", state: "valid", updated_at: "2026-11-20T00:00:00Z" },
    { id: "b", text: "The preset pins commit 305e335.", state: "valid", updated_at: "2026-11-26T00:00:00Z" },
    { id: "c", text: "A third, unrelated memory about the bank layout.", state: "valid" },
  ])
  try {
    const inventory = await client.inventory()
    assert.equal(inventory.scanned, 3)
    const findings = scan(inventory.memories)
    const plan = buildPlan(inventory.bank, findings, inventory.memories)
    assert.equal(plan.operations.length, 1)
    assert.equal(plan.operations[0].memoryId, "a")

    const report = await applyPlan(client, plan, [plan.operations[0].id], { auditOnly: false })
    assert.equal(report.results[0].status, "applied")

    const retired = await client.getMemory("a")
    assert.equal(retired.state, "invalidated")
    assert.equal((await client.getMemory("b")).state, "valid")
  } finally {
    close()
  }
})

test("the client refuses a bank the server does not serve", async () => {
  const { client, close } = await server([])
  try {
    await assert.rejects(() => client.getMemory("x"), /404/)
  } finally {
    close()
  }
})
