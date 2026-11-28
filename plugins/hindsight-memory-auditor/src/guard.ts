/** The agent ID that the installed agent file produces: `.opencode/agents/memory-auditor.md`. */
export const AUDITOR_AGENT = "memory-auditor"

/** The one subagent the auditor may launch: read-only evidence checks. */
export const WORKER_AGENT = "memory-auditor-worker"

/** Tools the auditor may use: repository reading plus its own memory tools. */
const ALLOWED = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "memory_auditor_status",
  "memory_auditor_scan",
  "memory_auditor_inventory",
  "memory_auditor_assign",
  "memory_auditor_report",
  "memory_auditor_inspect",
  "memory_auditor_evidence",
  "memory_auditor_git",
  "memory_auditor_recall",
  "memory_auditor_entities",
  // Read-only view of the same bank from the official Hindsight coding-agent tools.
  "hindsight_search_pages",
  "hindsight_read_page",
  "hindsight_list_pages",
  "memory_auditor_propose",
  "memory_auditor_preview",
  "memory_auditor_apply",
  "memory_auditor_verify",
])

/**
 * Returns the reason to block a tool call, or undefined to allow it. Prompt text is never the
 * barrier: this runs on every tool execution and inspects the effective agent.
 */
export function denyReason(agentId: string | undefined, tool: string, input?: unknown): string | undefined {
  // Only exact registered IDs establish tool identity; foreign suffix matches are unsafe.
  if (agentId === WORKER_AGENT) {
    return ["read", "glob", "grep", "memory_auditor_evidence", "memory_auditor_git", "memory_auditor_inspect", "memory_auditor_recall", "memory_auditor_submit"].includes(tool)
      ? undefined : `Memory Auditor worker may not use \`${tool}\`: only registered assignment reads and report submission are permitted.`
  }
  if (agentId !== AUDITOR_AGENT) return undefined
  if (tool === "subagent" || tool === "task") return "Use memory_auditor_assign so the worker is bound before it starts."
  if (ALLOWED.has(tool)) return undefined
  return `Memory Auditor may not use \`${tool}\`: repository reads, bound audit assignments and approved bank plans only.`
}
