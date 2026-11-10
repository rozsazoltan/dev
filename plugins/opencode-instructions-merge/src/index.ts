import { Plugin } from "@opencode/plugin"
import { INSTRUCTION_MARKER, mergeInstructions, parseOptions } from "./merge.ts"

/** OpenCode V2 server plugin. Injects exactly one model-visible system part. */
export default Plugin.define({
  id: "rozsazoltan.instructions-merge",
  async setup(ctx) {
    const config = parseOptions(ctx.options)
    const projectRoot = ctx.location.project.canonical || ctx.location.directory

    const inject = async (event: { system: Array<{ type: string; text?: string }> }): Promise<void> => {
      if (event.system.some((part) => part.type === "text" && part.text?.startsWith(INSTRUCTION_MARKER))) return
      const merged = await mergeInstructions(config, projectRoot)
      for (const warning of merged.warnings) {
        console.warn(`[rozsazoltan.instructions-merge] ${warning}`)
      }
      if (!merged.text) return
      event.system.push({ type: "text", text: merged.text })
    }

    await ctx.session.hook("context", inject)
    if (config.includeCompaction) await ctx.session.hook("compaction", inject)
  },
})
