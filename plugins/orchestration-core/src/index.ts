import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config.ts"
import { measureContext, thresholdMessage, toolAllowedAtHardLimit } from "./context.ts"
import { HindsightClient } from "./hindsight.ts"
import { MemoryManager } from "./memory.ts"
import { DEFAULT_POLICY, omoSlimAvailable, POLICY_DESCRIPTION } from "./policy.ts"
import { isSyntheticPrompt, Registry } from "./registry.ts"
import { flushOutbox, StateStore } from "./state.ts"
import { createTools } from "./tools.ts"

/**
 * OpenCode V2 plugin: deterministic orchestration infrastructure. It captures genuine prompts,
 * journals failed writes, measures the active context and enforces the hard budget at tool
 * execution. Semantic decisions, planning and delegation choices stay with the Orchestrator.
 */
export default Plugin.define({
  id: "rozsazoltan.opencode-orchestration-core",
  async setup(ctx) {
    const projectDir = ctx.location.project?.canonical || ctx.location.directory
    const config = resolveConfig(ctx.options, process.env, projectDir)
    const client = new HindsightClient(config)
    const store = new StateStore(ctx.storage)
    const registry = new Registry(client, store, projectDir)
    const memory = new MemoryManager(client, config)

    await ctx.session.hook("prompt", async (input) => {
      const sessionID = input.sessionID
      // Retry journaled Hindsight writes on every turn; a failed write is never dropped.
      await store.update(sessionID, async (state) => {
        await flushOutbox(client, state)
      }).catch(() => undefined)

      const promptText = input.prompt?.text ?? ""
      if (config.promptRegistry && promptText.trim()) {
        const metadata = (input.metadata ?? undefined) as Record<string, unknown> | undefined
        if (!isSyntheticPrompt(promptText, metadata)) {
          // Capture is best effort on this turn; the journal or Hindsight write reports its own state.
          await registry.capture({ sessionID, messageID: input.messageID, text: promptText, metadata }).catch(() => undefined)
        }
      }

      if (!config.contextGuard) return
      const reading = await measureContext(sessionID, ctx.session, config)
      const notice = thresholdMessage(reading, config)
      if (!notice || reading.threshold === "ok") return
      const anchor = reading.anchorAt ?? `${reading.tokens ?? 0}`
      const shouldNudge = await store.update(sessionID, (state) => {
        if (state.context.nudgedAnchor === anchor) return false
        state.context.nudgedAnchor = anchor
        state.context.anchorTokens = reading.tokens
        state.context.anchorAt = reading.anchorAt
        state.context.estimatedChars = reading.estimatedChars
        return true
      })
      if (!shouldNudge) return
      await ctx.session.synthetic({
        sessionID,
        text: notice,
        description: "Orchestration context budget",
        resume: false,
      }).catch(() => undefined)
    })

    await ctx.session.hook("context", async (input) => {
      if (!config.policyInjection) return
      // Only inject where the append belongs: the OMO-Slim Orchestrator prompt.
      if (!omoSlimAvailable(projectDir)) return
      if (input.system.some((part) => part.metadata?.description === POLICY_DESCRIPTION)) return
      input.system.push({
        type: "text",
        text: config.policyText ?? DEFAULT_POLICY,
        metadata: { description: POLICY_DESCRIPTION },
      })
    })

    await ctx.tool.transform((editor) => {
      for (const tool of createTools(client, config, store, registry, memory, ctx.session)) editor.add(tool)
    })

    await ctx.tool.hook("execute.before", async (input) => {
      if (!config.contextGuard) return
      if (toolAllowedAtHardLimit(input.tool, config)) return
      const reading = await measureContext(input.sessionID, ctx.session, config)
      if (reading.threshold !== "hard") return
      const notice = thresholdMessage(reading, config)
      if (notice) throw new Error(notice)
    })
  },
})
