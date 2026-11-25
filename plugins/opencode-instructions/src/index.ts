import { Plugin } from "@opencode/plugin"
import { collectInstructionCandidates, INSTRUCTION_MARKER, mergeInstructions, parseOptions, readInstructionSource } from "./merge.ts"
import { Instructions } from "./rpc.ts"
import { normalizeInstructionPath, readToggles, writeToggles } from "./toggles.ts"

/** OpenCode V2 server plugin. Injects exactly one model-visible system part. */
export default Plugin.define({
  id: "rozsazoltan.opencode-instructions",
  async setup(ctx) {
    const config = parseOptions({
      ...ctx.options,
      includeBuiltin: ctx.options.includeBuiltin ?? true,
      includeDefaultDirectories: ctx.options.includeDefaultDirectories ?? true,
    })
    const projectRoot = ctx.location.project.canonical || ctx.location.directory
    const storage = ctx.storage

    let updates = Promise.resolve()
    const registration = await ctx.rpc.register(Instructions, {
      list: async () => {
        const toggles = await readToggles(storage)
        const candidates = await collectInstructionCandidates({ ...config, includeBuiltin: config.includeBuiltin && toggles.builtin }, projectRoot)
        return {
          files: candidates.map((file) => ({
            path: file.path,
            label: file.label,
            exists: file.exists,
            enabled: !toggles.disabled.has(normalizeInstructionPath(file.path)),
            scope: file.scope,
          })),
          builtin: toggles.builtin,
        }
      },
      read: async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("path" in input) || typeof input.path !== "string") {
          throw new Error("Invalid instruction read request")
        }
        const { path } = input
        // Preview ignores the built-in master switch: a hidden-from-context file can still be read and edited.
        const candidates = await collectInstructionCandidates(config, projectRoot)
        const key = normalizeInstructionPath(path)
        const candidate = candidates.find((file) => normalizeInstructionPath(file.path) === key)
        if (!candidate) throw new Error(`Unknown instruction path: ${path}`)
        if (!candidate.exists) throw new Error(`Missing instruction file: ${candidate.label}`)
        return { content: await readInstructionSource(candidate.path, config.maxFileBytes) }
      },
      set: async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("path" in input) || typeof input.path !== "string" || !("enabled" in input) || typeof input.enabled !== "boolean") {
          throw new Error("Invalid instruction toggle request")
        }
        const { path, enabled } = input
        const operation = updates.then(async () => {
          const toggles = await readToggles(storage)
          const candidates = await collectInstructionCandidates({ ...config, includeBuiltin: config.includeBuiltin && toggles.builtin }, projectRoot)
          const key = normalizeInstructionPath(path)
          if (!candidates.some((file) => normalizeInstructionPath(file.path) === key)) {
            throw new Error(`Unknown instruction path: ${path}`)
          }
        }).then(async () => {
          const toggles = await readToggles(storage)
          if (enabled) toggles.disabled.delete(normalizeInstructionPath(path))
          else toggles.disabled.add(normalizeInstructionPath(path))
          await writeToggles(storage, toggles)
          await registration.events.emit("changed", {})
          return { ok: true }
        })
        updates = operation.then(() => undefined, () => undefined)
        return operation
      },
      setBuiltin: async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("enabled" in input) || typeof input.enabled !== "boolean") {
          throw new Error("Invalid built-in toggle request")
        }
        const { enabled } = input
        const operation = updates.then(async () => {
          const toggles = await readToggles(storage)
          if (toggles.builtin === enabled) return
          toggles.builtin = enabled
          await writeToggles(storage, toggles)
          await registration.events.emit("changed", {})
        })
        updates = operation.then(() => undefined, () => undefined)
        return operation.then(() => ({ ok: true }))
      },
    })

    const inject = async (event: { system: Array<{ type: string; text?: string }> }): Promise<void> => {
      if (event.system.some((part) => part.type === "text" && part.text?.startsWith(INSTRUCTION_MARKER))) return
      const toggles = await readToggles(storage)
      const merged = await mergeInstructions({ ...config, includeBuiltin: config.includeBuiltin && toggles.builtin }, projectRoot, toggles.disabled)
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
