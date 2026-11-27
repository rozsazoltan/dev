import { buildPlan, scan } from "./audit.ts"
import { applyPlan, verifyPlan } from "./executor.ts"
import type { HindsightClient } from "./hindsight.ts"
import { createEvidence, formatEvidence, type VcsLike, createGitEvidence } from "./evidence.ts"
import { PlanStore } from "./plans.ts"
import type { AuditorConfig, Finding, Inventory, MemoryUnit, Plan } from "./types.ts"

export interface AuditorState {
  inventory?: Inventory
  findings?: Finding[]
}

const text = (value: string) => (value.length > 240 ? `${value.slice(0, 240)}…` : value)

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
  state: AuditorState,
  root: string,
  plans: PlanStore,
  vcs?: VcsLike,
) {
  const evidence = createEvidence(root)
  const git = vcs ? createGitEvidence(vcs, root) : undefined
  return [
    {
      name: "memory_auditor_status",
      description:
        "Report the Memory Auditor scope: selected Hindsight bank, server, audit-only flag, and what the current session can change.",
      input: object({}),
      async execute() {
        return {
          content: [
            `bank: ${client.bank}`,
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
      description:
        "Read the whole bank and the deterministic findings (duplicates, short fragments, conflicting openings). Read-only; it does not change any memory.",
      input: object({}),
      async execute() {
        const inventory = await client.inventory()
        const findings = scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings

        const counts = findings.reduce<Record<string, number>>((all, finding) => {
          all[finding.state] = (all[finding.state] ?? 0) + 1
          return all
        }, {})
        return {
          content: [
            `bank: ${inventory.bank}`,
            `scanned: ${inventory.scanned} (valid ${inventory.valid}, invalidated ${inventory.invalidated})${inventory.truncated ? " — truncated at maxMemories, coverage is partial" : ""}`,
            `findings: ${findings.length} ${JSON.stringify(counts)}`,
            ...findings.slice(0, 20).map((finding) => `- [${finding.state}] ${finding.id}: ${finding.detail}`),
            findings.length > 20 ? `… ${findings.length - 20} more findings` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_inspect",
      description: "Show one memory with its provenance, state and invalidation reason.",
      input: object({ memoryId: { type: "string" } }, ["memoryId"]),
      async execute(input: unknown) {
        const memoryId = readString(input, "memoryId")
        const memory = await client.getMemory(memoryId)
        return { content: formatMemory(memory) }
      },
    },
    {
      name: "memory_auditor_git",
      description:
        "Read-only git view: branch and head information, working tree status, or a bounded diff. No command is executed.",
      input: object({ mode: { type: "string", enum: ["info", "status", "diff"] }, base: { type: "string" } }, ["mode"]),
      async execute(input: unknown) {
        if (!git) throw new Error("Git evidence is unavailable in this project.")
        const mode = readString(input, "mode")
        if (mode === "info") return { content: await git.info() }
        if (mode === "status") return { content: await git.status() }
        if (mode !== "diff") throw new Error("Unknown git mode; use info, status or diff.")
        const base = readOptionalString(input, "base")
        return { content: await git.diff("working", base) }
      },
    },
    {
      name: "memory_auditor_evidence",
      description:
        "Read-only evidence for the repository paths a finding depends on: existence, size and first line. Paths stay inside the project root.",
      input: object({ paths: { type: "array", items: { type: "string" } } }, ["paths"]),
      async execute(input: unknown) {
        const paths = readStrings(input, "paths")
        if (paths.length === 0) throw new Error("Invalid input: paths must list at least one repository path")
        const entries = await evidence.inspect(paths)
        return { content: formatEvidence(entries, root) }
      },
    },
    {
      name: "memory_auditor_preview",
      description:
        "Build a typed plan from the last scan. Optional findingIds narrow it to selected findings. Returns operation IDs; nothing is applied.",
      input: object({ findingIds: { type: "array", items: { type: "string" } } }),
      async execute(input: unknown) {
        const inventory = state.inventory ?? (await client.inventory())
        const findings = state.findings ?? scan(inventory.memories)
        state.inventory = inventory
        state.findings = findings
        const selected = readStrings(input, "findingIds")
        const chosen = selected.length === 0 ? findings : findings.filter((finding) => selected.includes(finding.id))
        const plan = buildPlan(inventory.bank, chosen, inventory.memories)
        await plans.save(plan)
        if (plan.operations.length === 0) {
          return { content: `plan ${plan.id}: no automatic operations. ${findings.length} findings stay manual.` }
        }
        return {
          content: [
            `plan: ${plan.id} (bank ${plan.bank}, ${plan.createdAt})`,
            `operations: ${plan.operations.length}`,
            ...plan.operations.map((operation) => `- ${operation.id}: ${operation.kind} ${operation.memoryId} — "${text(operation.before)}"`),
            "Apply with memory_auditor_apply({ planId, operationIds }) after the user approves these exact IDs.",
          ].join("\n"),
        }
      },
    },
    {
      name: "memory_auditor_apply",
      description:
        "Apply approved operations from a stored plan. Requires the plan ID and the exact operation IDs the user approved; targets are re-read first.",
      input: object({ planId: { type: "string" }, operationIds: { type: "array", items: { type: "string" } } }, [
        "planId",
        "operationIds",
      ]),
      async execute(input: unknown) {
        const planId = readString(input, "planId")
        const plan = await plans.load(planId)
        if (!plan) throw new Error(`Unknown plan ${planId}: run memory_auditor_preview first.`)
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
      description: "Read every approved item back and report the observed state.",
      input: object({ planId: { type: "string" }, operationIds: { type: "array", items: { type: "string" } } }, [
        "planId",
        "operationIds",
      ]),
      async execute(input: unknown) {
        const planId = readString(input, "planId")
        const plan = await plans.load(planId)
        if (!plan) throw new Error(`Unknown plan ${planId}: run memory_auditor_preview first.`)
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

function formatMemory(memory: MemoryUnit): string {
  return [
    `id: ${memory.id}`,
    `state: ${memory.state ?? "valid"}`,
    `type: ${memory.fact_type ?? "unknown"}`,
    `document: ${memory.document_id ?? "none"}`,
    `updated: ${memory.updated_at ?? memory.mentioned_at ?? memory.date ?? "unknown"}`,
    memory.invalidation_reason ? `invalidated because: ${memory.invalidation_reason}` : "",
    `text: ${text(memory.text)}`,
  ]
    .filter(Boolean)
    .join("\n")
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

function readStrings(input: unknown, key: string): string[] {
  if (typeof input !== "object" || input === null) return []
  const value = (input as Record<string, unknown>)[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid input: ${key} must be an array of strings`)
  }
  return value as string[]
}
