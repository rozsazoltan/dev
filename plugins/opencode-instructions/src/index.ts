import { Plugin } from "@opencode/plugin"
import { collectInstructionCandidates, INSTRUCTION_MARKER, mergeInstructions, parseOptions } from "./merge.ts"
import { Instructions } from "./rpc.ts"
import { normalizeInstructionPath, readDisabled, writeDisabled } from "./toggles.ts"

/** OpenCode V2 server plugin. Injects exactly one model-visible system part. */
export default Plugin.define({
  id: "rozsazoltan.opencode-instructions",
  async setup(ctx) {
    const config = parseOptions(ctx.options)
    const projectRoot = ctx.location.project.canonical || ctx.location.directory
    const storage = ctx.storage

    let updates = Promise.resolve()
    const registration = await ctx.rpc.register(Instructions, {
      list: async () => {
        const disabled = await readDisabled(storage)
        const candidates = await collectInstructionCandidates(config, projectRoot)
        return {
          files: candidates.map((file) => ({
            path: file.path,
            label: file.label,
            exists: file.exists,
            enabled: !disabled.has(normalizeInstructionPath(file.path)),
          })),
        }
      },
      set: async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("path" in input) || typeof input.path !== "string" || !("enabled" in input) || typeof input.enabled !== "boolean") {
          throw new Error("Invalid instruction toggle request")
        }
        const { path, enabled } = input
        const operation = updates.then(async () => {
          const candidates = await collectInstructionCandidates(config, projectRoot)
          const key = normalizeInstructionPath(path)
          if (!candidates.some((file) => normalizeInstructionPath(file.path) === key)) {
            throw new Error(`Unknown instruction path: ${path}`)
          }
        }).then(async () => {
          const disabled = await readDisabled(storage)
          if (enabled) disabled.delete(normalizeInstructionPath(path))
          else disabled.add(normalizeInstructionPath(path))
          await writeDisabled(storage, disabled)
          await registration.events.emit("changed", {})
          return { ok: true }
        })
        updates = operation.then(() => undefined, () => undefined)
        return operation
      },
    })

    const inject = async (event: { system: Array<{ type: string; text?: string }> }): Promise<void> => {
      if (event.system.some((part) => part.type === "text" && part.text?.startsWith(INSTRUCTION_MARKER))) return
      const disabled = await readDisabled(storage)
      const merged = await mergeInstructions(config, projectRoot, disabled)
      for (const warning of merged.warnings) {
        console.warn(`[rozsazoltan.opencode-instructions] ${warning}`)
      }
      if (!merged.text) return
      event.system.push({ type: "text", text: merged.text })
    }

    await ctx.session.hook("context", inject)
    if (config.includeCompaction) await ctx.session.hook("compaction", inject)
  },
})
