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
  "memory_auditor_inspect",
  "memory_auditor_evidence",
  "memory_auditor_git",
  "memory_auditor_recall",
  "memory_auditor_entities",
  "memory_auditor_preview",
  "memory_auditor_apply",
  "memory_auditor_verify",
])

/**
 * Returns the reason to block a tool call, or undefined to allow it. Prompt text is never the
 * barrier: this runs on every tool execution and inspects the effective agent.
 */
export function denyReason(agentId: string | undefined, tool: string, input?: unknown): string | undefined {
  if (agentId !== AUDITOR_AGENT) return undefined
  // Some hosts qualify a tool name (`plugin.memory_auditor_scan`); compare the bare name too.
  const bare = tool.split(/[./:]/).pop() ?? tool
  if (bare === "subagent" || bare === "task") {
    return launchedAgent(input) === WORKER_AGENT
      ? undefined
      : `Memory Auditor may only launch the ${WORKER_AGENT} subagent.`
  }
  if (ALLOWED.has(tool) || ALLOWED.has(bare)) return undefined
  return `Memory Auditor may not use \`${tool}\`: it audits the Hindsight bank with repository evidence only, and never writes files, runs commands, delegates or reaches the network.`
}

function launchedAgent(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const value = (input as Record<string, unknown>).agent ?? (input as Record<string, unknown>).subagent
  return typeof value === "string" ? value : undefined
}
