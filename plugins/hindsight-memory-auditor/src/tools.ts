import { buildPlan, curatable, digestId, packPlan, scan } from "./audit.ts"
import { applyPlan, verifyPlan } from "./executor.ts"
import { createEvidence, createGitEvidence, formatEvidence, type VcsLike } from "./evidence.ts"
import type { HindsightClient } from "./hindsight.ts"
import type { PlanStore } from "./plans.ts"
import type { AuditorConfig, Finding, Inventory } from "./types.ts"
import type { Operation, Plan } from "./types.ts"
import { NativeApproval, type ApprovalCall } from "./approval.ts"
import { AuditTasks, CHECKS, type Assignment, type TaskRow } from "./tasks.ts"

/** Audits are per session: one conversation never reads or clears another's findings. */
/** `null` means the lookup failed; an empty list means the server really has no banks. */
export function describeBankPresence(banks: string[] | null, bank: string): string {
  if (banks === null) return "unknown (bank list unavailable)"
  return banks.includes(bank) ? "yes" : "NO — check the bank id or the integration template"
}

export interface SessionState {
  inventory?: Inventory
  findings?: Finding[]
  planId?: string
}

type ToolContext = Partial<ApprovalCall>

const excerpt = (value: string) => (value.length > 240 ? `${value.slice(0, 240)}…` : value)

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

/** Tool definitions; each returns `content` text so the transcript stays readable. */
export function createTools(
  client: HindsightClient,
  config: AuditorConfig,
  sessions: Map<string, SessionState>,
  root: string,
  plans: PlanStore,
  vcs?: VcsLike,
  runtime?: { tasks: AuditTasks; approval: NativeApproval },
) {
  const evidence = createEvidence(root)
  const git = vcs ? createGitEvidence(vcs, root) : undefined

  function session(context?: ToolContext): { id: string; state: SessionState } {
    const id = context?.sessionID
    if (!id) throw new Error("A real tool session is required.")
    const state = sessions.get(id) ?? {}
    sessions.set(id, state)
    return { id, state }
  }

  const tools = [
    {
      name: "memory_auditor_status",
      options: { codemode: false },
      description:
        "Report the selected bank and mandatory once-only plan confirmation boundary.",
      input: object({}),
      async execute(_input: unknown, context?: ToolContext) {
        const banks = await client.withSignal(context?.signal).banks().catch((): null => null)
        const present = describeBankPresence(banks, client.bank)
        return {
          content: [
            `bank: ${client.bank} (exists on server: ${present})`,
            `server: ${new URL(config.apiUrl).host}`,
            `pageSize: ${config.pageSize}`,
            `maxMemories: ${config.maxMemories}`,
            "mutations: exact immutable plan and fresh native once-only confirmation required",
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_scan",
      options: { codemode: false },
      description:
        "Read the whole bank and the deterministic findings (duplicates, short fragments, observations with retired sources). Read-only; it does not change any memory.",
      input: object({ checks: { type: "array", items: { type: "string", enum: CHECKS } } }),
      async execute(input: unknown, context?: ToolContext) {
        const { id, state } = session(context)
        const inventory = await client.withSignal(context?.signal).inventory()
        const findings = scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings
        const checks = readStrings(input, "checks")
        const run = runtime ? await runtime.tasks.start(id, inventory, checks.length ? checks : CHECKS) : undefined
        const counts = findings.reduce<Record<string, number>>((all, finding) => {
          all[finding.state] = (all[finding.state] ?? 0) + 1
          return all
        }, {})
        return {
          content: [
            `bank: ${inventory.bank}`,
            `run: ${run?.id ?? "runtime unavailable"}; revision: ${inventory.revision}`,
            `inventory complete: ${inventory.complete}; semantic checks complete: false`,
            ...inventory.warnings,
            `scanned: ${inventory.scanned} (valid ${inventory.valid}, invalidated ${inventory.invalidated})${inventory.truncated ? " — truncated at maxMemories, coverage is partial" : ""}`,
            `findings: ${findings.length} ${JSON.stringify(counts)}`,
            ...findings.map((finding) => `- [${finding.state}] ${finding.id} on ${finding.memoryIds.join(",")}: ${excerpt(finding.detail)}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_inventory",
      options: { codemode: false },
      description:
        "Page through the raw memory units of the whole bank with their type, state, dates and text, so the auditor can analyse every memory rather than only findings.",
      input: object({ runId: { type: "string" }, offset: { type: "number" }, limit: { type: "number" }, state: { type: "string" }, factType: { type: "string" } }),
      async execute(input: unknown, context?: ToolContext) {
        const { id, state: stored } = session(context)
        const offset = readNumber(input, "offset", 0, 1_000_000)
        const limit = Math.max(1, readNumber(input, "limit", 25, 100))
        const state = readOptionalString(input, "state")
        const factType = readOptionalString(input, "factType")
        const inventory = runtime
          ? (await runtime.tasks.run(id, readOptionalString(input, "runId"))).inventory
          : stored.inventory
        if (!inventory) throw new Error("Scan before reading the inventory revision.")
        const matching = inventory.memories.filter((memory) => (!factType || memory.fact_type === factType) && (!state || memory.state === state))
        const items = matching.slice(offset, offset + limit)
        return {
          content: JSON.stringify({ revision: inventory.revision, complete: inventory.complete, warnings: inventory.warnings,
            offset, total: matching.length, nextOffset: offset + items.length < matching.length ? offset + items.length : null, items }, null, 2),
        }
      },
    },
    {
      name: "memory_auditor_inspect",
      options: { codemode: false },
      description: "Show one memory with its provenance, state, invalidation reason and full text.",
      input: object({ memoryId: { type: "string" } }, ["memoryId"]),
      async execute(input: unknown, context?: ToolContext) {
        const memory = await client.withSignal(context?.signal).getMemory(readString(input, "memoryId"))
        return {
          content: JSON.stringify(memory, null, 2),
        }
      },
    },
    {
      name: "memory_auditor_evidence",
      options: { codemode: false },
      description:
        "Read-only evidence for the repository paths a finding depends on: existence, size and first line. Paths stay inside the project root.",
      input: object({ paths: { type: "array", items: { type: "string" } } }, ["paths"]),
      async execute(input: unknown, context?: ToolContext) {
        const paths = readStrings(input, "paths")
        if (paths.length === 0) throw new Error("Invalid input: paths must list at least one repository path")
        return { content: formatEvidence(await evidence.inspect(paths), root) }
      },
    },
    {
      name: "memory_auditor_git",
      options: { codemode: false },
      description:
        "Read-only git view: branch and head information, working tree status, or a bounded diff. No command is executed.",
      input: object({ mode: { type: "string", enum: ["info", "status", "diff"] }, base: { type: "string" } }, ["mode"]),
      async execute(input: unknown) {
        if (!git) throw new Error("Git evidence is unavailable in this project.")
        const mode = readString(input, "mode")
        if (mode === "info") return { content: await git.info() }
        if (mode === "status") return { content: await git.status() }
        if (mode !== "diff") throw new Error("Unknown git mode; use info, status or diff.")
        return { content: await git.diff("working", readOptionalString(input, "base")) }
      },
    },
    {
      name: "memory_auditor_recall",
      options: { codemode: false },
      description:
        "Semantic search inside the bank: ranked by meaning, not keywords. Use it to find related memories for a finding instead of scanning text.",
      input: object({ query: { type: "string" }, limit: { type: "number" } }, ["query"]),
      async execute(input: unknown, context?: ToolContext) {
        const query = readString(input, "query")
        const limit = readNumber(input, "limit", 10, 50)
        const results = await client.withSignal(context?.signal).recall(query, limit)
        return {
          content: [
            `query: ${query} (${results.length} results)`,
            ...results.map(
              (result) =>
                `- ${result.id} [${result.type ?? "unknown"}${result.scores?.final !== undefined ? `, score ${result.scores.final.toFixed(2)}` : ""}] ${excerpt(result.text)}`,
            ),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_entities",
      options: { codemode: false },
      description:
        "List the entities the bank tracks with their mention counts, so conflicting or outdated facts can be grouped by subject instead of by wording.",
      input: object({ limit: { type: "number" }, offset: { type: "number" } }),
      async execute(input: unknown, context?: ToolContext) {
        const limit = readNumber(input, "limit", 50, 200)
        const offset = readNumber(input, "offset", 0, 100000)
        const page = await client.withSignal(context?.signal).entities({ limit, offset })
        return {
          content: [
            `entities: ${page.items.length} of ${page.total} (offset ${offset})`,
            ...page.items.map(
              (entity) => `- ${entity.canonical_name} (${entity.mention_count} mentions, ${entity.id})`,
            ),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_propose",
      options: { codemode: false },
      description:
        "Build or append an exact correction to an immutable cumulative plan. Invalidate/restore require no text; edit/merge require replacement text. Nothing is written.",
      input: object(
        {
          kind: { type: "string", enum: ["merge", "edit", "invalidate", "restore"] },
          memoryIds: { type: "array", items: { type: "string" } },
          text: { type: "string" },
          context: { type: "string" },
          reason: { type: "string" },
          planId: { type: "string" },
        },
        ["kind", "memoryIds", "reason"],
      ),
      async execute(input: unknown, context?: ToolContext) {
        const { id, state } = session(context)
        const kind = readString(input, "kind")
        const memoryIds = readStrings(input, "memoryIds")
        if (!["merge", "edit", "invalidate", "restore"].includes(kind) || !memoryIds.length ||
            new Set(memoryIds).size !== memoryIds.length || memoryIds.some((id) => !id.trim())) throw new Error("Distinct target IDs and a supported operation kind are required.")
        const text = kind === "edit" || kind === "merge" ? readString(input, "text") : undefined
        const reason = readString(input, "reason")
        const context_ = readOptionalString(input, "context")
        if (context_ && kind !== "merge") throw new Error("Only merge can set retention context; other operations preserve existing context.")
        const scoped = client.withSignal(context?.signal)
        const memories = await Promise.all(memoryIds.map((memoryId) => scoped.getMemory(memoryId)))
        for (const memory of memories) {
          if (memory.state !== (kind === "restore" ? "invalidated" : "valid")) throw new Error(`Memory ${memory.id} has the wrong state for ${kind}.`)
          if (!curatable(memory)) throw new Error(`Memory ${memory.id} is not curatable (fact_type: ${memory.fact_type ?? "unknown"}).`)
        }
        if (kind === "edit" && memories.length !== 1) throw new Error("edit takes exactly one target.")
        if (kind === "merge" && memories.length < 2) throw new Error("merge needs at least two source facts.")
        const operations: Operation[] = kind === "merge" ? [{
          id: digestId(kind, JSON.stringify({ memories, text, context_, reason })),
          kind, memoryId: memories[0]!.id, reason, before: memories[0]!.text,
          beforeSnapshot: memories[0],
          sources: memories.map((memory) => ({ ...memory, snapshot: memory })),
          text, context: context_,
          documentId: `memory-auditor-${digestId("merge-document", JSON.stringify({ memories, text, context_, reason }))}`,
        }] : memories.map((memory) => ({
          id: digestId(kind, JSON.stringify({ memory, text, reason })),
          kind: kind as "invalidate" | "restore" | "edit", memoryId: memory.id, reason,
          before: memory.text, beforeSnapshot: memory, ...(text !== undefined ? { text } : {}),
        }))
        const parentId = readOptionalString(input, "planId")
        const parent = parentId ? await plans.load(id, parentId) : undefined
        if (parentId && !parent) throw new Error("The parent plan is unavailable or corrupt in this session.")
        if (parent && parent.bank !== client.bank) throw new Error("The parent plan belongs to another bank.")
        const combined = [...(parent?.operations ?? []), ...operations]
        const plan = packPlan(client.bank, parent?.findings ?? [], combined)
        await plans.save(id, plan)
        state.planId = plan.id
        return { content: formatPlan(plan) }
      },
    },
    {
      name: "memory_auditor_preview",
      options: { codemode: false },
      description:
        "Build a typed plan from this session's last scan. Optional findingIds narrow it to selected findings. Returns operation IDs; nothing is applied.",
      input: object({ planId: { type: "string" }, findingIds: { type: "array", items: { type: "string" } } }),
      async execute(input: unknown, context?: ToolContext) {
        const { id, state } = session(context)
        const planId = readOptionalString(input, "planId") ?? state.planId
        if (planId) {
          const existing = await plans.load(id, planId)
          if (!existing) throw new Error("No immutable plan with that ID exists in this session.")
          return { content: formatPlan(existing) }
        }
        // One snapshot: a concurrent scan must not pair new findings with an older inventory.
        const snapshot = { inventory: state.inventory, findings: state.findings }
        const inventory = snapshot.inventory ?? (runtime
          ? (await runtime.tasks.run(id)).inventory : await client.withSignal(context?.signal).inventory())
        const findings =
          snapshot.inventory && snapshot.findings ? snapshot.findings : scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings
        const selected = readStrings(input, "findingIds")
        if (selected.some((id) => !findings.some((finding) => finding.id === id))) throw new Error("Unknown finding ID.")
        const chosen = selected.length === 0 ? findings : findings.filter((finding) => selected.includes(finding.id))
        const plan = buildPlan(inventory.bank, chosen, inventory.memories)
        await plans.save(id, plan)
        state.planId = plan.id
        if (plan.operations.length === 0) {
          return { content: `plan ${plan.id}: no automatic operations. ${findings.length} findings stay manual.` }
        }
        return { content: formatPlan(plan) }
      },
    },
    {
      name: "memory_auditor_apply",
      options: { codemode: false },
      description:
        "Apply approved operations from a stored plan. Requires the plan ID and the exact operation IDs the user approved; targets and keepers are re-read first.",
      input: object({ planId: { type: "string" }, operationIds: { type: "array", items: { type: "string" } } }, [
        "planId",
        "operationIds",
      ]),
      async execute(input: unknown, context?: ToolContext) {
        const { id } = session(context)
        const planId = readString(input, "planId")
        const plan = await plans.load(id, planId)
        if (!plan) throw new Error(`Unknown plan ${planId}: run memory_auditor_preview in this session first.`)
        const operationIds = readStrings(input, "operationIds")
        if (!operationIds.length || new Set(operationIds).size !== operationIds.length ||
            operationIds.some((opId) => !plan.operations.some((operation) => operation.id === opId))) throw new Error("Select distinct known operation IDs before confirmation.")
        if (!runtime || !context?.sessionID || !context.messageID || !context.id || !context.signal || context.agent !== "memory-auditor") {
          throw new Error("Native primary-auditor confirmation context is required; nothing was applied.")
        }
        await runtime.approval.confirm({
          server: config.apiUrl, bank: plan.bank, planHash: plan.hash, operationIds, summary: formatPlan(plan),
        }, context as ApprovalCall)
        const current = await plans.load(id, planId)
        if (!current || current.hash !== plan.hash) throw new Error("Plan changed during confirmation; request fresh approval.")
        context.signal.throwIfAborted()
        const report = await applyPlan(client.withSignal(context.signal), current, operationIds, { signal: context.signal })
        return {
          content: [
            `plan: ${report.planId} (bank ${report.bank})`,
            ...report.results.map((result) => `- ${result.operationId}: ${result.status} — ${result.detail}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_verify",
      options: { codemode: false },
      description: "Read every approved item back and report the observed state.",
      input: object({ planId: { type: "string" }, operationIds: { type: "array", items: { type: "string" } } }, [
        "planId",
        "operationIds",
      ]),
      async execute(input: unknown, context?: ToolContext) {
        const { id } = session(context)
        const planId = readString(input, "planId")
        const plan = await plans.load(id, planId)
        if (!plan) throw new Error(`Unknown plan ${planId}: run memory_auditor_preview in this session first.`)
        const report = await verifyPlan(client.withSignal(context?.signal), plan, readStrings(input, "operationIds"))
        return {
          content: [
            `plan: ${report.planId} (bank ${report.bank})`,
            ...report.results.map((result) => `- ${result.operationId}: ${result.status} — ${result.detail}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_assign",
      options: { codemode: false },
      description: "Create one focused read-only worker task, bind it before prompting, and return its task/session IDs. One active assignment per primary session.",
      input: object({
        runId: { type: "string" }, check: { type: "string", enum: CHECKS },
        memoryIds: { type: "array", items: { type: "string" } },
        referenceIds: { type: "array", items: { type: "string" } },
        evidencePaths: { type: "array", items: { type: "string" } },
        allowRecall: { type: "boolean" }, allowGit: { type: "boolean" },
        question: { type: "string" }, exclusions: { type: "string" },
      }, ["check", "memoryIds", "question", "exclusions"]),
      async execute(input: unknown, context?: ToolContext) {
        const { id } = session(context)
        if (!runtime || context?.agent !== "memory-auditor") throw new Error("Only the primary auditor can assign a bound worker.")
        const task = await runtime.tasks.assign(id, {
          runId: readOptionalString(input, "runId"), check: readString(input, "check"),
          memoryIds: readStrings(input, "memoryIds"), referenceIds: readStrings(input, "referenceIds"),
          evidencePaths: readStrings(input, "evidencePaths"), question: readString(input, "question"),
          exclusions: readString(input, "exclusions"),
          allowRecall: (input as Record<string, unknown>).allowRecall === true,
          allowGit: (input as Record<string, unknown>).allowGit === true,
        })
        return { content: JSON.stringify(task, null, 2) }
      },
    },
    {
      name: "memory_auditor_submit",
      options: { codemode: false },
      description: "Worker-only: submit exactly one coverage result per assigned target, for the registered category. No bank writes.",
      input: object({
        taskId: { type: "string" },
        rows: { type: "array", items: object({
          memoryId: { type: "string" }, check: { type: "string", enum: CHECKS },
          status: { type: "string", enum: ["clean", "finding", "blocked", "incomplete"] },
          verdict: { type: "string", enum: ["VERIFIED", "HISTORICAL", "OUTDATED", "INCORRECT", "CONTRADICTORY", "DUPLICATE", "UNVERIFIED", "STALE_DERIVED", "LOW_SIGNAL"] },
          claim: { type: "string" }, evidence: { type: "string" }, reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          action: { type: "string", enum: ["keep", "invalidate", "restore", "edit", "merge", "investigate"] },
          supportingMemoryIds: { type: "array", items: { type: "string" } }, replacement: { type: "string" }, keeper: { type: "string" },
        }, ["memoryId", "check", "status", "verdict", "claim", "evidence", "reason", "confidence", "action"]) },
      }, ["taskId", "rows"]),
      async execute(input: unknown, context?: ToolContext) {
        const { id } = session(context)
        if (!runtime || context?.agent !== "memory-auditor-worker") throw new Error("Only a bound worker can submit a report.")
        const rows = (input as Record<string, unknown>).rows
        if (!Array.isArray(rows)) throw new Error("Expected structured coverage rows.")
        const task = await runtime.tasks.submit(id, readString(input, "taskId"), rows as TaskRow[])
        return { content: `Accepted task ${task.id}; ${task.results!.length} scoped rows. No bank changes.\n${formatTaskTable(task)}` }
      },
    },
    {
      name: "memory_auditor_report",
      options: { codemode: false },
      description: "Primary-only: read all accepted task tables and per-ID/check coverage. Cancel a blocked active task explicitly; cancellation preserves incomplete coverage.",
      input: object({ runId: { type: "string" }, cancelTaskId: { type: "string" } }),
      async execute(input: unknown, context?: ToolContext) {
        const { id } = session(context)
        if (!runtime || context?.agent !== "memory-auditor") throw new Error("Only the primary auditor can reconcile task reports.")
        const cancel = readOptionalString(input, "cancelTaskId")
        if (cancel) await runtime.tasks.cancel(id, cancel)
        const report = await runtime.tasks.report(id, readOptionalString(input, "runId"))
        const summary = JSON.stringify({
          runId: report.run.id, bank: report.run.inventory.bank, revision: report.run.inventory.revision,
          complete: report.complete, warnings: report.run.inventory.warnings, coverage: report.coverage,
          tasks: report.tasks.map(({ results, ...task }) => ({ ...task, coverage: results?.map(({ memoryId, status }) => ({ memoryId, status })) })),
        }, null, 2)
        return { content: [summary, ...report.tasks.map(formatTaskTable)].join("\n\n") }
      },
    },
  ]
  return tools.map((tool) => {
    const execute = tool.execute as (input: unknown, context?: ToolContext) => Promise<{ content: string }>
    return { ...tool, async execute(input: unknown, context?: ToolContext) {
      const task = context?.sessionID && runtime ? await runtime.tasks.binding(context.sessionID) : undefined
      if (context?.agent === "memory-auditor-worker" || task) {
        if (!task || !runtime || !(await runtime.tasks.workerReadAllowed(task, tool.name, input))) {
          throw new Error("Worker tool call lies outside its registered read-only assignment.")
        }
      }
      context?.signal?.throwIfAborted()
      return execute(input, context)
    } }
  })
}

function formatPlan(plan: Plan): string {
  return JSON.stringify({
    ...plan,
    impact: "Edits can discard derived observations. Retained extraction must exactly match approved text/context before sources retire.",
    recovery: "Use a fresh approved plan: restore retired source facts; reverse edits with the saved before text. Reprocessing sources may recreate retired memories. Merge retries after partial writes require explicit recovery, not inferred progress.",
  }, null, 2)
}

function formatTaskTable(task: Assignment): string {
  const rows = task.results ?? []
  const findings = rows.filter((row) => row.status === "finding")
  const counts = `task ${task.id}: findings=${findings.length}, clean=${rows.filter((row) => row.status === "clean").length}, blocked=${rows.filter((row) => row.status === "blocked").length}, incomplete=${task.memoryIds.length - rows.filter((row) => row.status === "clean" || row.status === "finding").length}`
  if (!findings.length) return `${counts}\nNo reported in-scope findings; inspect blocked/incomplete coverage.`
  const cell = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`")
    .replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("!", "\\!").replace(/\r?\n/g, "<br>")
  return [
    counts,
    "| Task | Memory ID | Check | Verdict | Quoted claim | Evidence | Reason | Confidence | Proposed action | Replacement / keeper |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map((row) => `| ${[task.id, row.memoryId, row.check, row.verdict, row.claim, row.evidence, row.reason,
      row.confidence, row.action, row.replacement ?? row.keeper ?? ""].map(cell).join(" | ")} |`),
  ].join("\n")
}

function readString(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) throw new Error(`Invalid input: expected an object with ${key}`)
  const value = (input as Record<string, unknown>)[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Invalid input: ${key} must be a nonempty string`)
  return value
}

function readOptionalString(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function readNumber(input: unknown, key: string, fallback: number, maximum: number): number {
  if (typeof input !== "object" || input === null) return fallback
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback
}

function readStrings(input: unknown, key: string): string[] {
  if (typeof input !== "object" || input === null) return []
  const value = (input as Record<string, unknown>)[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid input: ${key} must be an array of strings`)
  }
  return value as string[]
}
