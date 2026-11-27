/** The agent ID that the installed agent file produces: `.opencode/agents/memory-auditor.md`. */
export const AUDITOR_AGENT = "memory-auditor"

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
  "memory_auditor_preview",
  "memory_auditor_apply",
  "memory_auditor_verify",
])

/**
 * Returns the reason to block a tool call, or undefined to allow it. Prompt text is never the
 * barrier: this runs on every tool execution and inspects the effective agent.
 */
export function denyReason(agentId: string | undefined, tool: string): string | undefined {
  if (agentId !== AUDITOR_AGENT) return undefined
  if (ALLOWED.has(tool)) return undefined
  return `Memory Auditor may not use \`${tool}\`: it audits the Hindsight bank with repository evidence only, and never writes files, runs commands, delegates or reaches the network.`
}
