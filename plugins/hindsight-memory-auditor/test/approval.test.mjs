import assert from "node:assert/strict"
import test from "node:test"
import { NativeApproval, APPLY_ACTION } from "../src/approval.ts"

function host({ effect = "allow", reply = "once", events = true, reject = false, mutateAsked, mutateReply, streamError = false } = {}) {
  let evaluate
  let push
  const calls = []
  const prompts = []
  const ctx = {
    permission: {
      async hook(name, callback) { assert.equal(name, "evaluate"); evaluate = callback },
      async assert(input) {
        calls.push(input)
        const decision = { ...input, effect }
        await evaluate(decision)
        assert.equal(decision.effect, effect === "deny" ? "deny" : "ask")
        if (decision.effect === "deny" || reject) throw new Error("denied")
        prompts.push(input.resources[0])
        if (events) {
          const asked = { ...input, id: `request-${calls.length}` }
          const replied = { sessionID: input.sessionID, requestID: `request-${calls.length}`, reply }
          mutateAsked?.(asked)
          mutateReply?.(replied)
          push({ type: "permission.asked", data: asked })
          push({ type: "permission.replied", data: replied })
        }
      },
    },
    event: {
      async *subscribe({ signal }) {
        if (streamError) throw new Error("stream closed")
        const queue = []
        let wake
        push = (event) => { queue.push(event); wake?.() }
        const stop = () => wake?.()
        signal.addEventListener("abort", stop)
        try {
          while (!signal.aborted) {
            if (!queue.length) await new Promise((resolve) => { wake = resolve })
            while (queue.length) yield queue.shift()
          }
        } finally { signal.removeEventListener("abort", stop) }
      },
    },
  }
  return { ctx, calls, prompts }
}

const binding = { server: "http://127.0.0.1:8890", bank: "bank", planHash: "hash", operationIds: ["one"], summary: "Retire one source fact" }
const call = () => ({ sessionID: "session", agent: "memory-auditor", messageID: "message", id: "call", signal: new AbortController().signal })

test("saved allow still requires a fresh once-only native request on every call", async () => {
  const fake = host()
  const gate = await NativeApproval.create(fake.ctx)
  await gate.confirm(binding, call())
  await gate.confirm(binding, call())
  assert.equal(fake.calls.length, 2)
  assert.notEqual(fake.prompts[0], fake.prompts[1])
  assert.equal(fake.calls[0].action, APPLY_ACTION)
  assert.deepEqual(fake.calls[0].save, [])
  assert.deepEqual(fake.calls[0].metadata.operationIds, ["one"])
})

test("native deny, rejection and non-once replies never authorize writes", async () => {
  for (const options of [{ effect: "deny" }, { reject: true }, { reply: "always" }, { reply: "reject" }]) {
    const fake = host(options)
    const gate = await NativeApproval.create(fake.ctx)
    await assert.rejects(gate.confirm(binding, call()))
  }
})

test("successful assert without a correlated receipt fails closed", async () => {
  const fake = host({ events: false })
  const gate = await NativeApproval.create(fake.ctx)
  await assert.rejects(gate.confirm(binding, call()), /No correlated/)
})

test("worker or aborted calls cannot request approval", async () => {
  const fake = host()
  const gate = await NativeApproval.create(fake.ctx)
  await assert.rejects(gate.confirm(binding, { ...call(), agent: "memory-auditor-worker" }), /primary-auditor/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(gate.confirm(binding, { ...call(), signal: controller.signal }))
  assert.equal(fake.calls.length, 0)
})

test("another session, call source or request cannot supply the approval receipt", async () => {
  for (const options of [
    { mutateAsked: (data) => { data.sessionID = "another-session" } },
    { mutateAsked: (data) => { data.source = { ...data.source, id: "another-call" } } },
    { mutateReply: (data) => { data.requestID = "another-request" } },
  ]) {
    const fake = host(options)
    const gate = await NativeApproval.create(fake.ctx)
    await assert.rejects(gate.confirm(binding, call()), /No correlated/)
  }
})

test("cancelling an outstanding native prompt returns without authorization", async () => {
  const fake = host({ events: false })
  fake.ctx.permission.assert = async () => new Promise(() => {})
  const controller = new AbortController()
  const gate = await NativeApproval.create(fake.ctx)
  const pending = gate.confirm(binding, { ...call(), signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /cancelled/)
})

test("a failed receipt stream ends the attempt instead of leaving it pending", async () => {
  const fake = host({ streamError: true })
  fake.ctx.permission.assert = async () => new Promise(() => {})
  const gate = await NativeApproval.create(fake.ctx)
  await assert.rejects(gate.confirm(binding, call()), /events are unavailable/)
})
