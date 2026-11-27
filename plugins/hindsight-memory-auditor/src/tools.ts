import { buildPlan, scan } from "./audit.ts"
import { applyPlan, verifyPlan } from "./executor.ts"
import { createEvidence, createGitEvidence, formatEvidence, type VcsLike } from "./evidence.ts"
import type { HindsightClient } from "./hindsight.ts"
import type { PlanStore } from "./plans.ts"
import type { AuditorConfig, Finding, Inventory } from "./types.ts"

/** Audits are per session: one conversation never reads or clears another's findings. */
/** `null` means the lookup failed; an empty list means the server really has no banks. */
export function describeBankPresence(banks: string[] | null, bank: string): string {
  if (banks === null) return "unknown (bank list unavailable)"
  return banks.includes(bank) ? "yes" : "NO — check the bank id or the integration template"
}

export interface SessionState {
  inventory?: Inventory
  findings?: Finding[]
}

interface ToolContext {
  sessionID?: string
}

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
) {
  const evidence = createEvidence(root)
  const git = vcs ? createGitEvidence(vcs, root) : undefined

  function session(context?: ToolContext): { id: string; state: SessionState } {
    const id = context?.sessionID ?? "default"
    const state = sessions.get(id) ?? {}
    sessions.set(id, state)
    return { id, state }
  }

  return [
    {
      name: "memory_auditor_status",
      options: { codemode: false },
      description:
        "Report the Memory Auditor scope: selected Hindsight bank, server, audit-only flag, and what the current session can change.",
      input: object({}),
      async execute() {
        const banks = await client.banks().catch((): null => null)
        const present = describeBankPresence(banks, client.bank)
        return {
          content: [
            `bank: ${client.bank} (exists on server: ${present})`,
            `server: ${new URL(config.apiUrl).host}`,
            `auditOnly: ${config.auditOnly}`,
            `pageSize: ${config.pageSize}`,
            `maxMemories: ${config.maxMemories}`,
            `mutations: ${config.auditOnly ? "disabled (auditOnly)" : "only through an approved plan"}`,
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_scan",
      options: { codemode: false },
      description:
        "Read the whole bank and the deterministic findings (duplicates, short fragments, observations with retired sources). Read-only; it does not change any memory.",
      input: object({}),
      async execute(_input: unknown, context?: ToolContext) {
        const { id, state } = session(context)
        const inventory = await client.inventory()
        const findings = scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings
        await plans.clear(id)
        const counts = findings.reduce<Record<string, number>>((all, finding) => {
          all[finding.state] = (all[finding.state] ?? 0) + 1
          return all
        }, {})
        return {
          content: [
            `bank: ${inventory.bank}`,
            `scanned: ${inventory.scanned} (valid ${inventory.valid}, invalidated ${inventory.invalidated})${inventory.truncated ? " — truncated at maxMemories, coverage is partial" : ""}`,
            `findings: ${findings.length} ${JSON.stringify(counts)}`,
            ...findings.map((finding) => `- [${finding.state}] ${finding.id} on ${finding.memoryIds.join(",")}: ${excerpt(finding.detail)}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_inspect",
      options: { codemode: false },
      description: "Show one memory with its provenance, state, invalidation reason and full text.",
      input: object({ memoryId: { type: "string" } }, ["memoryId"]),
      async execute(input: unknown) {
        const memory = await client.getMemory(readString(input, "memoryId"))
        return {
          content: [
            `id: ${memory.id}`,
            `state: ${memory.state ?? "valid"}`,
            `type: ${memory.fact_type ?? "unknown"}`,
            `document: ${memory.document_id ?? "none"}`,
            `updated: ${memory.updated_at ?? memory.mentioned_at ?? memory.date ?? "unknown"}`,
            memory.invalidation_reason ? `invalidated because: ${memory.invalidation_reason}` : "",
            "text:",
            memory.text,
          ]
            .filter(Boolean)
            .join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_evidence",
      options: { codemode: false },
      description:
        "Read-only evidence for the repository paths a finding depends on: existence, size and first line. Paths stay inside the project root.",
      input: object({ paths: { type: "array", items: { type: "string" } } }, ["paths"]),
      async execute(input: unknown) {
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
      async execute(input: unknown) {
        const query = readString(input, "query")
        const limit = readNumber(input, "limit", 10, 50)
        const results = await client.recall(query, limit)
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
      async execute(input: unknown) {
        const limit = readNumber(input, "limit", 50, 200)
        const offset = readNumber(input, "offset", 0, 100000)
        const page = await client.entities({ limit, offset })
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
      name: "memory_auditor_preview",
      options: { codemode: false },
      description:
        "Build a typed plan from this session's last scan. Optional findingIds narrow it to selected findings. Returns operation IDs; nothing is applied.",
      input: object({ findingIds: { type: "array", items: { type: "string" } } }),
      async execute(input: unknown, context?: ToolContext) {
        const { id, state } = session(context)
        // One snapshot: a concurrent scan must not pair new findings with an older inventory.
        const snapshot = { inventory: state.inventory, findings: state.findings }
        const inventory = snapshot.inventory ?? (await client.inventory())
        const findings =
          snapshot.inventory && snapshot.findings ? snapshot.findings : scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings
        const selected = readStrings(input, "findingIds")
        const chosen = selected.length === 0 ? findings : findings.filter((finding) => selected.includes(finding.id))
        const plan = buildPlan(inventory.bank, chosen, inventory.memories)
        await plans.save(id, plan)
        if (plan.operations.length === 0) {
          return { content: `plan ${plan.id}: no automatic operations. ${findings.length} findings stay manual.` }
        }
        return {
          content: [
            `plan: ${plan.id} (bank ${plan.bank}, ${plan.createdAt})`,
            `operations: ${plan.operations.length}`,
            ...plan.operations.map(
              (operation) =>
                `- ${operation.id}: ${operation.kind} ${operation.memoryId}${operation.keep ? ` (keeps ${operation.keep})` : ""} — "${excerpt(operation.before)}"`,
            ),
            "Apply with memory_auditor_apply({ planId, operationIds }) after the user approves these exact IDs.",
          ].join("\n"),
        }
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
        const report = await applyPlan(client, plan, readStrings(input, "operationIds"), { auditOnly: config.auditOnly })
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
        const report = await verifyPlan(client, plan, readStrings(input, "operationIds"))
        return {
          content: [
            `plan: ${report.planId} (bank ${report.bank})`,
            ...report.results.map((result) => `- ${result.operationId}: ${result.status} — ${result.detail}`),
          ].join("\n"),
        }
      },
    },
  ]
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
