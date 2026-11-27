import { createHash, randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"

export const APPLY_ACTION = "memory_auditor.apply"

type PermissionInput = Parameters<Plugin.Context["permission"]["assert"]>[0]
type ToolSource = Extract<NonNullable<PermissionInput["source"]>, { type: "tool" }>

export interface ApprovalCall {
  sessionID: PermissionInput["sessionID"]
  agent: NonNullable<PermissionInput["agent"]>
  messageID: ToolSource["messageID"]
  id: ToolSource["id"]
  signal: AbortSignal
}

interface Attempt {
  call: ApprovalCall
  requestID?: string
  evaluated: boolean
}

/** A saved permission or successful assert is not evidence of fresh human consent. */
export class NativeApproval {
  readonly #ctx: Pick<Plugin.Context, "permission" | "event">
  readonly #pending = new Map<string, Attempt>()

  private constructor(ctx: Pick<Plugin.Context, "permission" | "event">) {
    this.#ctx = ctx
  }

  static async create(ctx: Pick<Plugin.Context, "permission" | "event">): Promise<NativeApproval> {
    const gate = new NativeApproval(ctx)
    await ctx.permission.hook("evaluate", (input) => {
      if (input.action !== APPLY_ACTION) return
      const attempt = input.resources.length === 1 ? gate.#pending.get(input.resources[0]!) : undefined
      if (!attempt || !sameCall(input, attempt.call)) {
        input.effect = "deny"
        return
      }
      // Never weaken an explicit deny; force a fresh prompt even after a broad saved allow.
      if (input.effect !== "deny") {
        attempt.evaluated = true
        input.effect = "ask"
        input.message = "Approve this exact memory remediation plan once. Saved approval cannot authorize later writes."
      }
    })
    return gate
  }

  async confirm(
    binding: { server: string; bank: string; planHash: string; operationIds: string[]; summary: string },
    call: ApprovalCall,
  ): Promise<void> {
    if (!call.sessionID || !call.messageID || !call.id || call.agent !== "memory-auditor" || !call.signal) {
      throw new Error("Memory writes require an authenticated primary-auditor tool call.")
    }
    call.signal.throwIfAborted()
    const resource = createHash("sha256").update(JSON.stringify({
      server: binding.server,
      bank: binding.bank,
      planHash: binding.planHash,
      operationIds: [...binding.operationIds].sort(),
      sessionID: call.sessionID,
      messageID: call.messageID,
      callID: call.id,
      nonce: randomUUID(),
    })).digest("hex")
    const attempt: Attempt = { call, evaluated: false }
    this.#pending.set(resource, attempt)
    const stream = new AbortController()
    let accept!: () => void
    let reject!: (error: Error) => void
    const receipt = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail })
    // Event failures can precede the assert's completion.
    void receipt.catch(() => undefined)
    const pump = (async () => {
      try {
        for await (const event of this.#ctx.event.subscribe({
          types: ["permission.asked", "permission.replied"],
          signal: stream.signal,
        })) {
          if (event.type === "permission.asked") {
            const data = event.data
            if (data.action === APPLY_ACTION && data.resources.length === 1 && data.resources[0] === resource &&
                sameCall(data, call) && attempt.evaluated) {
              if (attempt.requestID) reject(new Error("Duplicate native approval request."))
              else attempt.requestID = data.id
            }
          } else if (event.type === "permission.replied" && event.data.sessionID === call.sessionID &&
                     event.data.requestID === attempt.requestID) {
            if (event.data.reply === "once") accept()
            else reject(new Error("Memory writes require a fresh once-only confirmation."))
          }
        }
        if (!stream.signal.aborted) reject(new Error("Native approval event stream ended."))
      } catch {
        reject(new Error("Native approval events are unavailable; no memory write is authorized."))
      }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort!: () => void
    const cancelled = new Promise<never>((_, fail) => {
      abort = () => fail(new Error("Memory approval cancelled; no write is authorized."))
      call.signal.addEventListener("abort", abort, { once: true })
      if (call.signal.aborted) abort()
    })
    // Pending forever on success, rejects as soon as the receipt stream fails.
    const receiptFailure = new Promise<never>((_, fail) => { receipt.catch(fail) })
    try {
      await Promise.race([this.#ctx.permission.assert({
        sessionID: call.sessionID,
        agent: call.agent,
        action: APPLY_ACTION,
        resources: [resource],
        save: [],
        source: { type: "tool", messageID: call.messageID, id: call.id },
        metadata: {
          bank: binding.bank,
          planHash: binding.planHash,
          operationIds: binding.operationIds,
          summary: binding.summary,
        },
      }), cancelled, receiptFailure])
      const missingReceipt = new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("No correlated once-only approval receipt; no write is authorized.")), 1000)
      })
      await Promise.race([receipt, missingReceipt, cancelled])
      call.signal.throwIfAborted()
    } finally {
      if (timer) clearTimeout(timer)
      call.signal.removeEventListener("abort", abort)
      this.#pending.delete(resource)
      stream.abort()
      void pump.catch(() => undefined)
    }
  }
}

function sameCall(
  input: { sessionID: string; source?: PermissionInput["source"]; agent?: string },
  call: ApprovalCall,
): boolean {
  return input.sessionID === call.sessionID &&
    (input.agent === undefined || input.agent === call.agent) &&
    input.source?.type === "tool" && input.source.messageID === call.messageID && input.source.id === call.id
}
