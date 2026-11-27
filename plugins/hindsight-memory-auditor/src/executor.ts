import type { HindsightClient } from "./hindsight.ts"
import type { ApplyReport, Operation, OperationResult, Plan } from "./types.ts"

/**
 * Applies only the operations the caller approved by ID. Each target is re-fetched first, so a
 * memory that changed after the plan was built is skipped instead of overwritten.
 */
export async function applyPlan(
  client: HindsightClient,
  plan: Plan,
  approvedOperationIds: readonly string[],
  options: { auditOnly: boolean },
): Promise<ApplyReport> {
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

/** Reads every affected memory back and reports the observed state. */
export async function verifyPlan(client: HindsightClient, plan: Plan, operationIds: readonly string[]): Promise<ApplyReport> {
  const approved = new Set(operationIds)
  const results: OperationResult[] = []
  for (const operation of plan.operations) {
    if (!approved.has(operation.id)) continue
    const expected = operation.kind === "restore" ? "valid" : "invalidated"
    try {
      const memory = await client.getMemory(operation.memoryId)
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
