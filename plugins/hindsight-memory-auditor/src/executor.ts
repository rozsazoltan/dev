import type { HindsightClient } from "./hindsight.ts"
import type { ApplyReport, Operation, OperationResult, OperationSource, Plan } from "./types.ts"

/**
 * Applies only the operations the caller approved by ID. Each target and keeper is re-fetched
 * first, so a changed memory is skipped instead of overwritten.
 *
 * Limitation: Hindsight exposes no versioned precondition, so this is a check-then-write and not a
 * transactional guard. A concurrent writer that changes a keeper between the read and the PATCH is
 * not detected; `restore` is the recovery path.
 */
export async function applyPlan(
  client: HindsightClient,
  plan: Plan,
  approvedOperationIds: readonly string[],
  options: { auditOnly: boolean },
): Promise<ApplyReport> {
  if (plan.bank !== client.bank) {
    throw new Error(`Plan ${plan.id} belongs to bank ${plan.bank}, but this session is scoped to ${client.bank}`)
  }
  if (options.auditOnly) {
    throw new Error("Audit-only mode is on: nothing was applied. Set the plugin option `auditOnly: false` to allow approved corrections.")
  }
  const approved = new Set(approvedOperationIds)
  const results: OperationResult[] = []
  for (const operation of plan.operations) {
    if (!approved.has(operation.id)) continue
    results.push(await applyOperation(client, operation))
  }
  const missing = [...approved].filter((id) => !plan.operations.some((operation) => operation.id === id))
  for (const id of missing) {
    results.push({ operationId: id, memoryId: "", status: "failed", detail: "Operation is not part of this plan." })
  }
  return { planId: plan.id, bank: plan.bank, results }
}

async function applyOperation(client: HindsightClient, operation: Operation): Promise<OperationResult> {
  try {
    if (operation.kind === "merge") return await applyMerge(client, operation)
    if (operation.kind === "edit") return await applyEdit(client, operation)
    if (operation.keep) {
      const keeper = await client.getMemory(operation.keep)
      if ((keeper.state ?? "valid") !== "valid") {
        return {
          operationId: operation.id,
          memoryId: operation.memoryId,
          status: "skipped",
          detail: "The duplicate keeper is no longer valid; keeping the target would preserve the fact.",
        }
      }
      if (keeper.text !== operation.keepBefore) {
        return {
          operationId: operation.id,
          memoryId: operation.memoryId,
          status: "skipped",
          detail: "The duplicate keeper changed after the plan was built; rebuild the plan.",
        }
      }
    }
    const current = await client.getMemory(operation.memoryId)
    if (current.state === "invalidated") {
      return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: "Already invalidated." }
    }
    if (current.text !== operation.before) {
      return {
        operationId: operation.id,
        memoryId: operation.memoryId,
        status: "skipped",
        detail: "Memory text changed after the plan was built; rebuild the plan.",
      }
    }
    await (operation.kind === "restore"
      ? client.restore(operation.memoryId, operation.reason)
      : client.invalidate(operation.memoryId, operation.reason))
    return { operationId: operation.id, memoryId: operation.memoryId, status: "applied", detail: operation.reason }
  } catch (error) {
    return {
      operationId: operation.id,
      memoryId: operation.memoryId,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Retains the merged text, then retires every source. A retry resumes: when the replacement
 * already exists, sources that are already invalidated are skipped instead of aborting the whole
 * operation, and every still-valid source is re-checked before it is retired.
 */
async function applyMerge(client: HindsightClient, operation: Operation): Promise<OperationResult> {
  const sources = operation.sources ?? []
  if (sources.length < 2 || !operation.text || !operation.documentId) {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "failed", detail: "Merge needs two sources, a text and a document id." }
  }
  const alreadyRetained = (await client.byDocument(operation.documentId)).some((memory) => (memory.state ?? "valid") === "valid")
  const pending: OperationSource[] = []
  for (const source of sources) {
    const current = await client.getMemory(source.id)
    const valid = (current.state ?? "valid") === "valid"
    if (!valid) {
      if (alreadyRetained) continue
      return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: `Source ${source.id} is no longer valid.` }
    }
    if (current.text !== source.text) {
      return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: `Source ${source.id} changed after the plan was built.` }
    }
    pending.push(source)
  }
  if (!alreadyRetained) {
    await client.retain({
      content: operation.text,
      context: operation.context,
      documentId: operation.documentId,
      metadata: { source: "memory-auditor", mergeOf: sources.map((source) => source.id).join(",") },
    })
  }
  for (const source of pending) await client.invalidate(source.id, operation.reason)
  return {
    operationId: operation.id,
    memoryId: operation.memoryId,
    status: pending.length > 0 || alreadyRetained ? "applied" : "skipped",
    detail: alreadyRetained ? `${operation.reason} (resumed)` : operation.reason,
  }
}

/** Rewrites one memory in place; the plan carries the exact text and the previous text. */
async function applyEdit(client: HindsightClient, operation: Operation): Promise<OperationResult> {
  if (!operation.text) {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "failed", detail: "Edit needs the new text." }
  }
  const current = await client.getMemory(operation.memoryId)
  if ((current.state ?? "valid") !== "valid") {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: "Target is no longer valid." }
  }
  if (current.text !== operation.before) {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: "Target changed after the plan was built; rebuild the plan." }
  }
  await client.updateText(operation.memoryId, operation.text)
  return { operationId: operation.id, memoryId: operation.memoryId, status: "applied", detail: operation.reason }
}

/** Reads every affected memory back and reports the observed state. */
export async function verifyPlan(client: HindsightClient, plan: Plan, operationIds: readonly string[]): Promise<ApplyReport> {
  if (plan.bank !== client.bank) {
    throw new Error(`Plan ${plan.id} belongs to bank ${plan.bank}, but this session is scoped to ${client.bank}`)
  }
  const approved = new Set(operationIds)
  const results: OperationResult[] = []
  const known = new Set(plan.operations.map((operation) => operation.id))
  for (const id of approved) {
    if (known.has(id)) continue
    results.push({ operationId: id, memoryId: "", status: "unverified", detail: "Operation is not part of this plan." })
  }
  for (const operation of plan.operations) {
    if (!approved.has(operation.id)) continue
    if (operation.kind === "merge") {
      results.push(await verifyMerge(client, operation))
      continue
    }
    const expected = operation.kind === "restore" ? "valid" : "invalidated"
    try {
      const memory = await client.getMemory(operation.memoryId)
      if (operation.kind === "edit") {
        const matches = memory.text === operation.text
        results.push({
          operationId: operation.id,
          memoryId: operation.memoryId,
          status: matches ? "applied" : "unverified",
          detail: matches ? "Text matches the approved rewrite." : "Text does not match the approved rewrite.",
        })
        continue
      }
      const state = memory.state ?? "valid"
      results.push({
        operationId: operation.id,
        memoryId: operation.memoryId,
        status: state === expected ? "applied" : "unverified",
        detail: `Observed state: ${state}; expected ${expected}.`,
      })
    } catch (error) {
      results.push({
        operationId: operation.id,
        memoryId: operation.memoryId,
        status: "unverified",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { planId: plan.id, bank: plan.bank, results }
}

/** A merge is verified by its retained document and the retirement of every source. */
async function verifyMerge(client: HindsightClient, operation: Operation): Promise<OperationResult> {
  try {
    const retained = await client.byDocument(operation.documentId ?? "")
    const states = await Promise.all((operation.sources ?? []).map((source) => client.getMemory(source.id)))
    const retired = states.length > 0 && states.every((memory) => (memory.state ?? "valid") !== "valid")
    const survivor = retained.some((memory) => (memory.state ?? "valid") === "valid")
    const ok = survivor && retired
    return {
      operationId: operation.id,
      memoryId: operation.memoryId,
      status: ok ? "applied" : "unverified",
      detail: `retained ${retained.length} memory/memories; sources retired: ${retired}`,
    }
  } catch (error) {
    return {
      operationId: operation.id,
      memoryId: operation.memoryId,
      status: "unverified",
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
