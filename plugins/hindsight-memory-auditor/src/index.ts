import { basename } from "node:path"
import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config.ts"
import type { VcsLike } from "./evidence.ts"
import { denyReason } from "./guard.ts"
import { HindsightClient } from "./hindsight.ts"
import { PlanStore } from "./plans.ts"
import { createTools, type SessionState } from "./tools.ts"

/**
 * OpenCode V2 server plugin. Registers the Memory Auditor tools and blocks every tool the
 * auditor may not use; the agent itself is the installed `agent/memory-auditor.md`.
 */
export default Plugin.define({
  id: "rozsazoltan.opencode-hindsight-memory-auditor",
  async setup(ctx) {
    const root = ctx.location.project.canonical || ctx.location.directory
    // The integration names banks after the project directory (`{gitProject}`).
    const config = resolveConfig(ctx.options, process.env, basename(root))
    const client = new HindsightClient(config)
    // One plugin instance serves every session at this location, so state is keyed by session.
    const sessions = new Map<string, SessionState>()
    const plans = new PlanStore(ctx.storage)

    await ctx.tool.transform((editor) => {
      for (const tool of createTools(client, config, sessions, root, plans, ctx.vcs as unknown as VcsLike)) editor.add(tool)
    })

    await ctx.tool.hook("execute.before", (input) => {
      const reason = denyReason(input.agent, input.tool, input.input)
      if (reason) throw new Error(reason)
    })
  },
})
