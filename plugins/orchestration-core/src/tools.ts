import type { OrchestrationConfig } from "./config.ts"
import { measureContext, thresholdMessage } from "./context.ts"
import type { HindsightClient } from "./hindsight.ts"
import { isOrchestrationDocument, MemoryManager } from "./memory.ts"
import { readPlanStatus } from "./planning.ts"
import { Registry } from "./registry.ts"
import { flushOutbox, type StateStore } from "./state.ts"
import type { DelegationRecord, RequestStatus } from "./types.ts"
import { REQUEST_STATUSES } from "./types.ts"

type ToolContext = { sessionID?: string; agent?: string; signal?: AbortSignal }
type ContextSource = { context(input: { sessionID: string }): Promise<unknown> }

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const string = (description: string) => ({ type: "string", description })
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description })
const number = (description: string) => ({ type: "number", description })
const bool = (description: string) => ({ type: "boolean", description })

function text(input: unknown, key: string, required: true): string
function text(input: unknown, key: string, required?: false): string | undefined
function text(input: unknown, key: string, required = false): string | undefined {
  const value = (input as Record<string, unknown> | null)?.[key]
  if (typeof value !== "string" || !value.trim()) {
    if (required) throw new Error(`${key} is required.`)
    return undefined
  }
  return value.trim()
}

function list(input: unknown, key: string): string[] {
  const value = (input as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function numeric(input: unknown, key: string, fallback: number, max = 100): number {
  const value = (input as Record<string, unknown> | null)?.[key]
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), 1), max)
}

const features = (config: OrchestrationConfig) => [
  `promptRegistry=${config.promptRegistry}`,
  `projectMemory=${config.projectMemory}`,
  `temporaryMemory=${config.temporaryMemory}`,
  `temporaryCleanup=${config.temporaryCleanup}`,
  `contextGuard=${config.contextGuard}`,
  `planStatus=${config.planStatus}`,
  `delegation=${config.delegation}`,
]

/** Registers the orchestration tools; each returns `content` text so transcripts stay readable. */
export function createTools(
  client: HindsightClient,
  config: OrchestrationConfig,
  store: StateStore,
  registry: Registry,
  memory: MemoryManager,
  session: ContextSource,
) {
  function sessionID(context?: ToolContext): string {
    if (!context?.sessionID) throw new Error("A real tool session is required.")
    return context.sessionID
  }

  return [
    {
      name: "orchestration_status",
      options: { codemode: false },
      description: "Report the resolved bank, feature switches, thresholds, request journal and planning state.",
      input: object({}),
      async execute(_input: unknown, context?: ToolContext) {
        const id = context?.sessionID
        const state = id ? await store.read(id) : undefined
        const plan = await readPlanStatus(config.projectDir)
        const reading = id ? await measureContext(id, session, config) : undefined
        return {
          content: [
            `bank: ${client.bank}`,
            `server: ${new URL(config.apiUrl).host}`,
            `project: ${config.projectDir}`,
            `features: ${features(config).join(", ")}`,
            `thresholds: soft ${config.softLimit}, compress ${config.compressLimit}, hard ${config.hardLimit} (tool \`${config.compressionTool}\`)`,
            `journal: ${state ? `${state.outbox.length} pending write(s)${state.outbox[0] ? `, last error: ${state.outbox[0].lastError ?? "none"}` : ""}` : "no session"}`,
            `plan: ${plan.detail}`,
            reading ? `context: ${reading.tokens ?? "unknown"} tokens (${reading.source}), threshold ${reading.threshold}` : "context: no session",
          ].join("\n"),
        }
      },
    },
    {
      name: "orchestration_requests",
      options: { codemode: false },
      description: "List or read the user-prompt registry records captured before execution.",
      input: object({ action: { type: "string", enum: ["list", "get"] }, id: string("Registry document id"), status: { type: "string", enum: [...REQUEST_STATUSES] }, limit: number("Maximum records"), offset: number("Pagination offset") }, ["action"]),
      async execute(input: unknown) {
        const action = text(input, "action", true)
        if (action === "get") {
          const id = text(input, "id", true)
          const record = await registry.get(id)
          return { content: JSON.stringify(record, null, 2) }
        }
        const status = text(input, "status") as RequestStatus | undefined
        const page = await registry.list({ status, limit: numeric(input, "limit", 20, 100), offset: numeric(input, "offset", 0, 10_000) })
        return {
          content: [
            `${page.records.length} record(s)${page.unreadable ? `, ${page.unreadable} unreadable` : ""}`,
            ...page.records.map((record) => `- ${record.id} [${record.status}] ${record.prompt.slice(0, 120).replace(/\s+/g, " ")}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "orchestration_request_update",
      options: { codemode: false },
      description: "Update one registry request: status, requirement statuses, evidence, reopening, cancellation, supersession.",
      input: object({
        id: string("Registry document id (user-prompt:<session>:<message>)"),
        status: { type: "string", enum: [...REQUEST_STATUSES] },
        note: string("Rationale; required for every transition"),
        evidence: strings("Evidence for completed/partially_completed/blocked/failed/not_applicable"),
        replacementID: string("Replacing request ID when superseding"),
        userWithdrawal: bool("Confirmed explicit user withdrawal, required to cancel"),
        reopen: bool("Reopen a terminal request"),
        requirements: {
          type: "array",
          description: "Per-requirement updates; unknown ids with text add a split requirement.",
          items: object({ id: string("Requirement id"), text: string("Text when adding"), status: { type: "string", enum: [...REQUEST_STATUSES] }, note: string("Rationale"), evidence: strings("Evidence") }, ["id"]),
        },
      }, ["id", "note"]),
      async execute(input: unknown, context?: ToolContext) {
        const record = await registry.transition(sessionID(context), text(input, "id", true), {
          status: text(input, "status") as RequestStatus | undefined,
          note: text(input, "note", true),
          evidence: list(input, "evidence"),
          replacementID: text(input, "replacementID"),
          userWithdrawal: (input as { userWithdrawal?: boolean }).userWithdrawal === true,
          reopen: (input as { reopen?: boolean }).reopen === true,
          requirements: ((input as { requirements?: Array<Record<string, unknown>> }).requirements ?? []).map((patch) => ({
            id: typeof patch.id === "string" ? patch.id : "",
            text: typeof patch.text === "string" ? patch.text : undefined,
            status: typeof patch.status === "string" ? (patch.status as RequestStatus) : undefined,
            note: typeof patch.note === "string" ? patch.note : undefined,
            evidence: Array.isArray(patch.evidence) ? patch.evidence.filter((item): item is string => typeof item === "string") : undefined,
          })),
        })
        return { content: `${record.id} is now ${record.status}.\n${JSON.stringify(record.requirements.map((item) => ({ id: item.id, status: item.status })), null, 2)}` }
      },
    },
    {
      name: "orchestration_memory",
      options: { codemode: false },
      description: "Recall project memory, retain verified project memory, or handle temporary memory (retain with TTL, promote, inspect).",
      input: object({
        action: { type: "string", enum: ["recall", "retain_project", "get", "retain_temporary", "promote"] },
        query: string("Recall query"),
        limit: number("Maximum hits or records"),
        id: string("Memory id"),
        textValue: string("Memory text"),
        evidence: strings("Evidence: file/line, command and exit status, or user decision reference"),
        decision: string("Explicit user decision that justifies the fact"),
        requestIDs: strings("Related user-prompt registry ids"),
        replace: bool("Replace an existing project memory, preserving history"),
        ttlHours: number("Temporary TTL in hours (1-48)"),
        verified: bool("Temporary finding already verified"),
      }, ["action"]),
      async execute(input: unknown, context?: ToolContext) {
        const action = text(input, "action", true)
        const id = text(input, "id")
        if (action === "recall") {
          const result = await memory.recall({ query: text(input, "query", true), limit: numeric(input, "limit", 10, 50) })
          return {
            content: [
              `${result.hits.length} hit(s)${result.filtered ? `; ${result.filtered} orchestration document(s) filtered out` : ""}`,
              ...result.hits.map((hit) => `- ${hit.document_id ?? hit.id} [${hit.type ?? "unknown"}] ${hit.text.slice(0, 200).replace(/\s+/g, " ")}`),
            ].join("\n"),
          }
        }
        if (action === "retain_project") {
          const result = await memory.retainProject({
            text: text(input, "textValue", true),
            id,
            evidence: list(input, "evidence"),
            decision: text(input, "decision"),
            requestIDs: list(input, "requestIDs"),
            replace: (input as { replace?: boolean }).replace === true,
          })
          await journal(context).catch(() => undefined)
          return { content: `${result.replaced ? "Updated" : "Created"} ${result.id}.` }
        }
        if (action === "retain_temporary") {
          const result = await memory.retainTemporary({
            text: text(input, "textValue", true),
            id,
            evidence: list(input, "evidence"),
            requestIDs: list(input, "requestIDs"),
            ttlHours: typeof (input as { ttlHours?: number }).ttlHours === "number" ? (input as { ttlHours: number }).ttlHours : undefined,
            verified: (input as { verified?: boolean }).verified === true,
          })
          return { content: `Temporary ${result.id} expires at ${result.expiresAt}.` }
        }
        if (action === "promote") {
          const result = await memory.promote({ id: id ?? "" })
          return { content: `Promoted to ${result.projectID}; source deleted: ${result.deletedSource}.` }
        }
        const found = await memory.get(id ?? "")
        return { content: JSON.stringify(found.envelope, null, 2) }
      },
    },
    {
      name: "orchestration_temp_purge",
      options: { codemode: false },
      description: "Report or delete expired temporary memories. Dry run by default; deletion requires temporaryCleanup.",
      input: object({ dryRun: bool("Report only; defaults to true"), limit: number("Maximum documents scanned") }),
      async execute(input: unknown) {
        const result = await memory.purgeTemporary({ dryRun: (input as { dryRun?: boolean }).dryRun !== false, limit: numeric(input, "limit", 200, 500) })
        return {
          content: [
            `${result.dryRun ? "DRY RUN" : "deletion enabled"}: scanned ${result.scanned}, expired ${result.expired}, deleted ${result.deleted}, skipped ${result.skipped}, failed ${result.failed.length}`,
            ...result.failed.map((item) => `- ${item.id}: ${item.error}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "orchestration_context",
      options: { codemode: false },
      description: "Measure the active context, report its threshold, and state the next compression action.",
      input: object({}),
      async execute(_input: unknown, context?: ToolContext) {
        const reading = await measureContext(sessionID(context), session, config)
        return {
          content: [
            `tokens: ${reading.tokens ?? "unknown"} (${reading.source})`,
            `threshold: ${reading.threshold} (soft ${config.softLimit}, compress ${config.compressLimit}, hard ${config.hardLimit})`,
            reading.detail,
            thresholdMessage(reading, config) ?? "No action needed.",
          ].join("\n"),
        }
      },
    },
    {
      name: "orchestration_plan",
      options: { codemode: false },
      description: "Read the active planning-with-files plan and phase status without modifying it.",
      input: object({}),
      async execute(_input: unknown) {
        if (!config.planStatus) return { content: "Plan status reporting is disabled (planStatus=false)." }
        const plan = await readPlanStatus(config.projectDir)
        return {
          content: [
            `plan: ${plan.planId ?? "none"}`,
            plan.detail,
            ...plan.phases.map((phase) => `- [${phase.status}] ${phase.name}`),
          ].join("\n"),
        }
      },
    },
    {
      name: "orchestration_delegation",
      options: { codemode: false },
      description: "Record or list a scoped delegation: agent, description, write/read scope, dependencies and status.",
      input: object({
        action: { type: "string", enum: ["record", "list", "update"] },
        id: string("Delegation id"),
        agent: string("Specialist agent name"),
        description: string("Scoped task"),
        writePaths: strings("Files this lane may write"),
        readPaths: strings("Files this lane may read for evidence"),
        dependsOn: strings("Upstream delegation ids"),
        status: { type: "string", enum: ["running", "done", "failed", "cancelled"] },
        limit: number("Maximum records listed"),
      }, ["action"]),
      async execute(input: unknown, context?: ToolContext) {
        if (!config.delegation) return { content: "Delegation tracking is disabled (delegation=false)." }
        const action = text(input, "action", true)
        const session = sessionID(context)
        if (action === "list") {
          const state = await store.read(session)
          return {
            content: state.delegations.length === 0 ? "No delegations recorded." : state.delegations
              .map((item) => `- ${item.id} [${item.status}] ${item.agent}: ${item.description} (writes: ${item.writePaths.join(", ") || "none"})`)
              .join("\n"),
          }
        }
        if (action === "update") {
          const result = await store.update(session, (state) => {
            const found = state.delegations.find((item) => item.id === text(input, "id", true))
            if (!found) throw new Error("Unknown delegation id.")
            const status = text(input, "status") as DelegationRecord["status"] | undefined
            if (status) found.status = status
            found.updatedAt = new Date().toISOString()
            return found
          })
          return { content: `${result.id} is now ${result.status}.` }
        }
        const at = new Date().toISOString()
        const record: DelegationRecord = {
          id: `delegation-${Date.now().toString(36)}`,
          sessionID: session,
          agent: text(input, "agent", true),
          description: text(input, "description", true),
          writePaths: list(input, "writePaths"),
          readPaths: list(input, "readPaths"),
          dependsOn: list(input, "dependsOn"),
          status: "running",
          createdAt: at,
          updatedAt: at,
        }
        await store.update(session, (state) => {
          state.delegations.push(record)
          if (state.delegations.length > 50) state.delegations.shift()
        })
        return {
          content: `Recorded ${record.id}: ${record.agent} writes ${record.writePaths.join(", ") || "nothing"}; reads ${record.readPaths.join(", ") || "not specified"}.`,
        }
      },
    },
  ]

  function journal(context?: ToolContext): Promise<void> {
    const id = context?.sessionID
    if (!id) return Promise.resolve()
    return store.update(id, async (state) => {
      await flushOutbox(client, state)
    })
  }
}

export const _internal = { isOrchestrationDocument }
