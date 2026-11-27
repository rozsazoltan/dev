import type { HindsightClient } from "./hindsight.ts"
import type { ApplyReport, Operation, OperationResult, OperationSource, Plan, MemoryUnit } from "./types.ts"
import { validatePlan, curatable, canonical } from "./audit.ts"

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
  options: { signal?: AbortSignal } = {},
): Promise<ApplyReport> {
  if (plan.bank !== client.bank) {
    throw new Error(`Plan ${plan.id} belongs to bank ${plan.bank}, but this session is scoped to ${client.bank}`)
  }
  const approved = new Set(approvedOperationIds)
  if (!approved.size || approvedOperationIds.some((id) => !id) || approved.size !== approvedOperationIds.length) throw new Error("Approved operation IDs must be nonempty and unique.")
  if (!validatePlan(plan)) throw new Error("Plan integrity check failed.")
  const selected = plan.operations.filter((operation) => approved.has(operation.id))
  if (selected.length !== approved.size || selected.some((operation) => !["invalidate", "restore", "merge", "edit"].includes(operation.kind))) throw new Error("Plan contains unknown operation IDs or unsupported operations.")
  for (const operation of selected) {
    if (!operation.id || !operation.reason || !operation.memoryId || (operation.kind === "edit" && !operation.text?.trim())) throw new Error("Selected operation is incomplete.")
    if (operation.kind === "merge") {
      if ((operation.sources?.length ?? 0) < 2 || !operation.text?.trim() || !operation.documentId ||
          operation.sources?.[0]?.id !== operation.memoryId || operation.sources[0].text !== operation.before ||
          operation.sources.some((source) => !source.snapshot || source.snapshot.id !== source.id)) throw new Error("Merge operation is incomplete.")
    } else if (!operation.beforeSnapshot || operation.beforeSnapshot.id !== operation.memoryId) throw new Error("Complete target snapshot required.")
    if (operation.keep && (!operation.keeperSnapshot || operation.keeperSnapshot.id !== operation.keep)) throw new Error("Complete keeper snapshot required.")
  }
  const writers = new Set<string>()
  const dependencies = new Set<string>()
  const documents = new Set<string>()
  for (const operation of selected) {
    const targets = operation.kind === "merge" ? (operation.sources ?? []).map((s) => s.id) : [operation.memoryId]
    for (const id of targets) if (!id || writers.has(id)) throw new Error(`Conflicting selected operations for memory ${id}.`); else writers.add(id)
    if (operation.keep) dependencies.add(operation.keep)
    if (operation.documentId) {
      if (documents.has(operation.documentId)) throw new Error("Selected merges share a retention document.")
      documents.add(operation.documentId)
    }
  }
  for (const id of dependencies) if (writers.has(id)) throw new Error(`Writer target conflicts with keeper ${id}.`)
  const snapshots = new Map<string, MemoryUnit>()
  for (const operation of selected) {
    checkAbort(options.signal)
    if (operation.kind === "merge") {
      for (const source of operation.sources ?? []) snapshots.set(source.id, await client.getMemory(source.id))
    } else snapshots.set(operation.memoryId, await client.getMemory(operation.memoryId))
    if (operation.keep) snapshots.set(operation.keep, await client.getMemory(operation.keep))
  }
  for (const operation of selected) {
    const targets = operation.kind === "merge" ? (operation.sources ?? []).map((s) => [s.id, s.text] as const) : [[operation.memoryId, operation.before] as const]
    for (const [id, expected] of targets) {
      const current = snapshots.get(id)!
      const expectedState = operation.kind === "restore" ? "invalidated" : "valid"
      const snapshot = operation.kind === "merge" ? operation.sources?.find((source) => source.id === id)?.snapshot : operation.beforeSnapshot
      if (!curatable(current) || current.text !== expected || current.state !== expectedState || !snapshotMatches(snapshot, current)) throw new Error(`Preflight failed for memory ${id}.`)
    }
    if (operation.keep) {
      const keeper = snapshots.get(operation.keep)!
      if (!curatable(keeper) || keeper.text !== operation.keepBefore || keeper.state !== "valid" || !snapshotMatches(operation.keeperSnapshot, keeper)) throw new Error(`Preflight failed for keeper ${operation.keep}.`)
    }
  }
  for (const operation of selected.filter((operation) => operation.kind === "merge")) {
    checkAbort(options.signal)
    if ((await client.byDocument(operation.documentId!)).length) {
      return { planId: plan.id, bank: plan.bank, results: selected.map((item) => ({
        operationId: item.id, memoryId: item.memoryId, status: item.id === operation.id ? "unverified" : "skipped",
        detail: "Merge document already exists; no selected operations were applied. Build an explicit recovery plan.",
      })) }
    }
  }
  const results: OperationResult[] = []
  for (const operation of plan.operations) {
    if (!approved.has(operation.id)) continue
    if (options.signal?.aborted) {
      // Work already happened: keep its results and report the rest as skipped.
      for (const remaining of selected.slice(results.length)) results.push({
        operationId: remaining.id, memoryId: remaining.memoryId, status: "skipped", detail: "Cancelled before this operation was attempted.",
      })
      break
    }
    const result = await applyOperation(client, operation, options.signal)
    results.push(result)
    if (result.status !== "applied") {
      for (const remaining of selected.slice(results.length)) results.push({
        operationId: remaining.id, memoryId: remaining.memoryId, status: "skipped", detail: "Not attempted after an earlier incomplete operation.",
      })
      break
    }
  }
  const missing = [...approved].filter((id) => !plan.operations.some((operation) => operation.id === id))
  for (const id of missing) {
    results.push({ operationId: id, memoryId: "", status: "failed", detail: "Operation is not part of this plan." })
  }
  return { planId: plan.id, bank: plan.bank, results }
}

function snapshotMatches(expected: MemoryUnit | undefined, actual: MemoryUnit, mutation?: Partial<MemoryUnit>): boolean {
  if (!expected || expected.id !== actual.id) return false
  const fields = ["state", "text", "fact_type", "type", "context", "tags", "date", "mentioned_at", "metadata", "document_id", "source_memory_ids", "source_memories", "observation_scopes"] as const
  const approved = { ...expected, ...mutation }
  return fields.every((field) => canonical(approved[field]) === canonical(actual[field])) &&
    (mutation !== undefined || expected.updated_at === actual.updated_at)
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted.")
}

async function applyOperation(client: HindsightClient, operation: Operation, signal?: AbortSignal): Promise<OperationResult> {
  try {
    if (operation.kind === "merge") return await applyMerge(client, operation, signal)
    if (operation.kind === "edit") return await applyEdit(client, operation, signal)
    if (operation.keep) {
      const keeper = await client.getMemory(operation.keep)
      if (keeper.state !== "valid" || !curatable(keeper) || !snapshotMatches(operation.keeperSnapshot, keeper)) {
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
    if (operation.kind === "invalidate" && current.state === "invalidated") {
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
    if (!curatable(current) || current.state !== (operation.kind === "restore" ? "invalidated" : "valid") ||
        !snapshotMatches(operation.beforeSnapshot, current)) return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: "Target snapshot changed before mutation." }
    checkAbort(signal)
    await (operation.kind === "restore"
      ? client.restore(operation.memoryId, operation.reason)
      : client.invalidate(operation.memoryId, operation.reason))
    const after = await client.getMemory(operation.memoryId)
    const expectedState = operation.kind === "restore" ? "valid" : "invalidated"
    if (!curatable(after) || !snapshotMatches(operation.beforeSnapshot, after, { state: expectedState })) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Mutation read-back did not match expected content and state." }
    if (operation.keep) {
      const keeperAfter = await client.getMemory(operation.keep)
      if (keeperAfter.state !== "valid" || !snapshotMatches(operation.keeperSnapshot, keeperAfter)) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Keeper changed during mutation." }
    }
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
 * Retains the merged text, verifies it exactly, then retires sources.
 */
async function applyMerge(client: HindsightClient, operation: Operation, signal?: AbortSignal): Promise<OperationResult> {
  const sources = operation.sources ?? []
  if (sources.length < 2 || !operation.text || !operation.documentId) {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "failed", detail: "Merge needs two sources, a text and a document id." }
  }
  const existing = await client.byDocument(operation.documentId)
  if (existing.length) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Merge document already exists; prior progress cannot be attributed safely." }
  if (new Set(sources.map((source) => source.id)).size !== sources.length) return { operationId: operation.id, memoryId: operation.memoryId, status: "failed", detail: "Merge sources must be unique." }
  for (const source of sources) {
    const current = await client.getMemory(source.id)
    if (current.state !== "valid" || !curatable(current) || current.text !== source.text || !snapshotMatches(source.snapshot, current)) {
      return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: `Source ${source.id} changed after the plan was built.` }
    }
  }
  try {
    checkAbort(signal)
    await client.retain({
      content: operation.text,
      context: operation.context,
      documentId: operation.documentId,
      metadata: { source: "memory-auditor", mergeOf: sources.map((source) => source.id).join(",") },
    })
    const retained = await client.byDocument(operation.documentId)
    const replacement = retained.filter((memory) => exactReplacement(memory, operation))
    if (replacement.length !== 1) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Approved replacement was not uniquely verified; sources remain valid." }
    for (const source of sources) {
      checkAbort(signal)
      const document = await client.byDocument(operation.documentId)
      const matches = document.filter((memory) => exactReplacement(memory, operation))
      if (matches.length !== 1 || matches[0]!.id !== replacement[0]!.id) {
        return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Replacement changed or is no longer unique; no further sources retired." }
      }
      const current = await client.getMemory(source.id)
      if (current.state !== "valid" || current.text !== source.text || !curatable(current) || !snapshotMatches(source.snapshot, current)) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: `Source ${source.id} changed; no further sources retired.` }
      await client.invalidate(source.id, operation.reason)
      const after = await client.getMemory(source.id)
      if (!snapshotMatches(source.snapshot, after, { state: "invalidated" })) return { operationId: operation.id, memoryId: source.id, status: "unverified", detail: "Source retirement read-back failed." }
    }
    return await verifyMerge(client, operation, replacement[0]!.id)
  } catch (error) {
    return { operationId: operation.id, memoryId: operation.memoryId, status: "failed", detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Rewrites one memory in place; the plan carries the exact text and the previous text. */
async function applyEdit(client: HindsightClient, operation: Operation, signal?: AbortSignal): Promise<OperationResult> {
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
  if (!curatable(current) || current.state !== "valid" || !snapshotMatches(operation.beforeSnapshot, current)) return { operationId: operation.id, memoryId: operation.memoryId, status: "skipped", detail: "Target snapshot changed before edit." }
  checkAbort(signal)
  await client.updateText(operation.memoryId, operation.text)
  const after = await client.getMemory(operation.memoryId)
  if (!curatable(after) || !snapshotMatches(operation.beforeSnapshot, after, { text: operation.text, state: "valid" })) return { operationId: operation.id, memoryId: operation.memoryId, status: "unverified", detail: "Edit read-back did not match approved content." }
  return { operationId: operation.id, memoryId: operation.memoryId, status: "applied", detail: operation.reason }
}

/** Reads every affected memory back and reports the observed state. */
export async function verifyPlan(client: HindsightClient, plan: Plan, operationIds: readonly string[]): Promise<ApplyReport> {
  if (plan.bank !== client.bank) {
    throw new Error(`Plan ${plan.id} belongs to bank ${plan.bank}, but this session is scoped to ${client.bank}`)
  }
  if (!validatePlan(plan)) throw new Error("Plan integrity check failed.")
  if (!operationIds.length || operationIds.some((id) => !id) || new Set(operationIds).size !== operationIds.length || operationIds.some((id) => !plan.operations.some((operation) => operation.id === id))) throw new Error("Verification operation IDs must be nonempty, unique, and known.")
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
        const matches = memory.state === "valid" && curatable(memory) && snapshotMatches(operation.beforeSnapshot, memory, { text: operation.text })
        results.push({
          operationId: operation.id,
          memoryId: operation.memoryId,
          status: matches ? "applied" : "unverified",
          detail: matches ? "Text matches the approved rewrite." : "Text does not match the approved rewrite.",
        })
        continue
      }
      const state = memory.state
      const keeper = operation.keep ? await client.getMemory(operation.keep) : undefined
      const matchesContent = curatable(memory) && snapshotMatches(operation.beforeSnapshot, memory, { state: expected }) &&
        (!operation.keep || (!!keeper && keeper.state === "valid" && snapshotMatches(operation.keeperSnapshot, keeper)))
      results.push({
        operationId: operation.id,
        memoryId: operation.memoryId,
        status: state === expected && matchesContent ? "applied" : "unverified",
        detail: `Observed state: ${state}; expected ${expected}; content unchanged: ${matchesContent}.`,
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
async function verifyMerge(client: HindsightClient, operation: Operation, expectedReplacementId?: string): Promise<OperationResult> {
  try {
    // Sources first, replacement last: the replacement check is the final observation.
    const states = await Promise.all((operation.sources ?? []).map((source) => client.getMemory(source.id)))
    const retired = states.length >= 2 && states.every((memory, index) => memory.state === "invalidated" && curatable(memory) && snapshotMatches(operation.sources?.[index]?.snapshot, memory, { state: "invalidated" }))
    const retained = await client.byDocument(operation.documentId ?? "")
    const matches = retained.filter((memory) => exactReplacement(memory, operation))
    const survivor = matches.length === 1 && (!expectedReplacementId || matches[0]!.id === expectedReplacementId)
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

function exactReplacement(memory: MemoryUnit, operation: Operation): boolean {
  return curatable(memory) && memory.state === "valid" && memory.text === operation.text &&
    (memory.context ?? undefined) === operation.context && memory.document_id === operation.documentId &&
    !operation.sources?.some((source) => source.id === memory.id)
}
