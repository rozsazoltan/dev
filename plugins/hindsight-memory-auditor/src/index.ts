import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config.ts"
import { denyReason } from "./guard.ts"
import { HindsightClient } from "./hindsight.ts"
import { createTools, type AuditorState } from "./tools.ts"

/**
 * OpenCode V2 server plugin. Registers the Memory Auditor tools and blocks every tool the
 * auditor may not use; the agent itself is the installed `agent/memory-auditor.md`.
 */
export default Plugin.define({
  id: "rozsazoltan.opencode-hindsight-memory-auditor",
  async setup(ctx) {
    const config = resolveConfig(ctx.options)
    const client = new HindsightClient(config)
    const state: AuditorState = { plans: new Map() }

    await ctx.tool.transform((editor) => {
      const root = ctx.location.project.canonical || ctx.location.directory
      for (const tool of createTools(client, config, state, root)) editor.add(tool)
    })

    await ctx.tool.hook("execute.before", (input) => {
      const reason = denyReason(input.agent, input.tool)
      if (reason) throw new Error(reason)
    })
  },
})
