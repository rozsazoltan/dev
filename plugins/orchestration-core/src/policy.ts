import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const POLICY_DESCRIPTION = "orchestration-policy"

/**
 * The append keeps only what code cannot enforce: judgement, interpretation and communication.
 * Registry, memory, thresholds, plan and ledger behaviour live in the plugin, so restating them
 * here would duplicate one meaning in two places and let them drift apart.
 */
export const DEFAULT_POLICY = `## Orchestrator role (orchestration-core)

Deterministic bookkeeping is enforced by the orchestration-core plugin: prompt registry and statuses,
project and temporary memory, context thresholds, plan reading and the delegation ledger. Do not restate
those rules; call the plugin tools and trust its enforcement.

Your part is judgement:

- Decide what you do yourself and what you delegate. Delegate only work a specialist does better, and only
  with a brief that names the scope, the evidence to collect and the validation owner.
- Judge subagent reports. A summary is a claim, not evidence: accept a result only when an artifact, a
  command result or a file line supports it, otherwise send it back to the same child to repair.
- Interpret the user's words: keep their scope, constraints and priorities. Ask before widening scope or
  taking an irreversible or external action.
- Reconcile before final checks: collect every writer's result, inspect the actual files, then run the
  relevant checks once at the settled state.
- Report results, not process: what changed, what was verified, and what remains unverified.`

function configCandidates(dir: string): string[] {
  const local = join(dir, ".opencode")
  return [
    join(dir, "opencode.json"),
    join(dir, "opencode.jsonc"),
    join(local, "opencode.json"),
    join(local, "opencode.jsonc"),
  ]
}

/**
 * OMO-Slim presence is detected from its own config file or from a plugin entry naming it.
 * Detection is a heuristic over installed configuration, not proof the agent preset is active.
 */
export function omoSlimAvailable(projectDir: string, home = homedir()): boolean {
  const own = [
    join(home, ".config", "opencode", "oh-my-opencode-slim.json"),
    join(home, ".config", "opencode", "oh-my-opencode-slim.jsonc"),
    join(projectDir, ".opencode", "oh-my-opencode-slim.json"),
    join(projectDir, ".opencode", "oh-my-opencode-slim.jsonc"),
  ]
  if (own.some((path) => existsSync(path))) return true
  const configs = [
    ...configCandidates(projectDir),
    ...configCandidates(join(home, ".config", "opencode")),
  ]
  for (const path of configs) {
    try {
      if (readFileSync(path, "utf8").includes("oh-my-opencode-slim")) return true
    } catch {
      // A missing or unreadable config is not evidence of OMO-Slim.
    }
  }
  return false
}
