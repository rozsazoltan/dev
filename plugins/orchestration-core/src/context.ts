import type { OrchestrationConfig } from "./config.ts"
import type { ContextReading } from "./types.ts"

interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface MessageLike {
  type?: string
  text?: string
  content?: unknown
  tokens?: TokenUsage
  time?: { created?: number }
}

type ContextSource = { context(input: { sessionID: string }): Promise<unknown> }

const CHARS_PER_TOKEN = 4

/**
 * Active context is anchored on the last completed assistant message: its prompt tokens are what
 * the provider charged for the window at that point. Messages after it are estimated and labelled.
 */
export async function measureContext(sessionID: string, source: ContextSource, thresholds: OrchestrationConfig): Promise<ContextReading> {
  let messages: MessageLike[]
  try {
    const value = await source.context({ sessionID })
    if (!Array.isArray(value)) throw new Error("context is not a message list")
    messages = value as MessageLike[]
  } catch (error) {
    return {
      source: "estimated",
      estimatedChars: 0,
      threshold: "ok",
      detail: `Context telemetry unavailable (${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}); thresholds are not enforced.`,
    }
  }
  let anchorIndex = -1
  let anchorTokens = 0
  let anchorAt: string | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type !== "assistant" || !message.tokens) continue
    anchorIndex = index
    anchorTokens = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    anchorAt = message.time?.created ? new Date(message.time.created).toISOString() : undefined
    break
  }
  if (anchorIndex < 0) {
    return { source: "estimated", estimatedChars: 0, threshold: "ok", detail: "No completed assistant usage yet; context size is unmeasured." }
  }
  const tail = messages.slice(anchorIndex + 1)
  const estimatedChars = tail.reduce((total, message) => total + estimateChars(message), 0)
  const windowChars = messages.reduce((total, message) => total + estimateChars(message), 0)
  const windowTokens = Math.ceil(windowChars / CHARS_PER_TOKEN)
  const anchored = anchorTokens + Math.ceil(estimatedChars / CHARS_PER_TOKEN)
  // Only the text actually present in the window can be verified here. A provider-reported anchor is
  // cumulative on some hosts, so it is capped by the window estimate instead of tripping a hard gate
  // on a number the transcript cannot support.
  const capped = windowTokens > 0 && anchored > windowTokens
  const tokens = windowTokens > 0 ? Math.min(anchored, windowTokens) : anchored
  return {
    tokens,
    source: !capped && !tail.length ? "measured" : "estimated",
    anchorAt,
    estimatedChars,
    threshold: classify(tokens, thresholds),
    detail: capped
      ? `anchor ${anchorTokens} tokens exceeds ~${windowTokens} tokens of message text; capped at the window estimate (~${windowChars} chars).`
      : `anchor ${anchorTokens} tokens${anchorAt ? ` at ${anchorAt}` : ""} plus ${tail.length} newer message(s) (~${estimatedChars} chars).`,
  }
}

function estimateChars(message: MessageLike): number {
  if (typeof message.text === "string") return message.text.length
  if (message.content === undefined) return 0
  try {
    return JSON.stringify(message.content).length
  } catch {
    return 0
  }
}

export function classify(tokens: number, thresholds: Pick<OrchestrationConfig, "softLimit" | "compressLimit" | "hardLimit">): ContextReading["threshold"] {
  if (tokens >= thresholds.hardLimit) return "hard"
  if (tokens >= thresholds.compressLimit) return "compress"
  if (tokens >= thresholds.softLimit) return "soft"
  return "ok"
}

export function thresholdMessage(reading: ContextReading, thresholds: OrchestrationConfig): string | undefined {
  if (reading.threshold === "ok") return undefined
  const value = reading.tokens?.toLocaleString("en-US") ?? "unknown"
  if (reading.threshold === "hard") {
    return `Orchestration context gate: active context is ${value} tokens, at or above the hard limit ${thresholds.hardLimit.toLocaleString("en-US")}. Stop nonessential execution, checkpoint the plan and request state, then call \`${thresholds.compressionTool}\`. Tool calls stay blocked until compression is confirmed.`
  }
  if (reading.threshold === "compress") {
    return `Orchestration context budget: ${value} tokens. Call \`${thresholds.compressionTool}\` before substantial new work and checkpoint the active plan first.`
  }
  return `Orchestration context budget: ${value} tokens. Compress at the next closed chapter; target the 100k-150k range.`
}

/** Compression and this plugin's own tools remain available at the hard limit. */
export function toolAllowedAtHardLimit(tool: string, thresholds: OrchestrationConfig): boolean {
  return tool === thresholds.compressionTool || tool.startsWith("orchestration_") || tool === "todoread"
}
