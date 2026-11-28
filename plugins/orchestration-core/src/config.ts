import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

const DEFAULT_URL = "http://127.0.0.1:8890"
const DEFAULT_INTEGRATION = join(homedir(), ".hindsight", "coding-agent.json")

export interface OrchestrationConfig {
  apiUrl: string
  bank: string
  token?: string
  projectDir: string
  requestTimeoutMs: number
  /** Feature switches the operator can disable without removing the plugin. */
  promptRegistry: boolean
  projectMemory: boolean
  temporaryMemory: boolean
  temporaryCleanup: boolean
  contextGuard: boolean
  planStatus: boolean
  delegation: boolean
  /** Active-context thresholds in tokens. */
  softLimit: number
  compressLimit: number
  hardLimit: number
  /** Name of the installed compression tool; DCP registers `compress`. */
  compressionTool: string
  maxPromptChars: number
  tempTtlHours: number
  nudgeCooldownMs: number
}

interface IntegrationConfig {
  apiUrl?: string
  bankIdTemplate?: string
}

export function readIntegrationConfig(path = DEFAULT_INTEGRATION): IntegrationConfig | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    return value && typeof value === "object" ? (value as IntegrationConfig) : undefined
  } catch {
    return undefined
  }
}

export function expandBankTemplate(template: string, projectName: string): string {
  const unknown = template.match(/\{[^}]+\}/g)?.filter((token) => token !== "{gitProject}") ?? []
  if (unknown.length > 0) throw new Error(`Unsupported bankIdTemplate placeholder(s): ${unknown.join(", ")}`)
  return template.replace(/\{gitProject\}/g, () => projectName)
}

/**
 * Resolves the Hindsight target the same way the audit plugin and the official integration do:
 * explicit option, then the environment, then the integration's own template. Never a guess.
 */
export function resolveConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv,
  projectDir: string,
  integrationPath = DEFAULT_INTEGRATION,
): OrchestrationConfig {
  const options = raw ?? {}
  const integration = readIntegrationConfig(integrationPath)
  const apiUrl =
    typeof options.apiUrl === "string" ? options.apiUrl : typeof integration?.apiUrl === "string" ? integration.apiUrl : DEFAULT_URL
  const url = new URL(apiUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`apiUrl must be http or https, received ${url.protocol}`)
  const token = typeof options.token === "string" ? options.token : env.HINDSIGHT_API_TOKEN
  if (token && url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("A bearer token requires https unless apiUrl points at a loopback host")
  }
  const bank = resolveBank(options.bank, env.HINDSIGHT_BANK_ID, integration?.bankIdTemplate, basename(projectDir))
  const softLimit = positive(options.softLimit, 100_000, 2_000_000)
  const compressLimit = positive(options.compressLimit, 150_000, 2_000_000)
  const hardLimit = positive(options.hardLimit, 200_000, 4_000_000)
  if (!(softLimit <= compressLimit && compressLimit <= hardLimit)) {
    throw new Error("Context thresholds must satisfy softLimit <= compressLimit <= hardLimit")
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    bank,
    token: token || undefined,
    projectDir,
    requestTimeoutMs: positive(options.requestTimeoutMs, 15_000, 120_000),
    promptRegistry: options.promptRegistry !== false,
    projectMemory: options.projectMemory !== false,
    // Temporary retention stays off until independent deletion and recall isolation are proven.
    temporaryMemory: options.temporaryMemory === true,
    temporaryCleanup: options.temporaryCleanup === true,
    contextGuard: options.contextGuard !== false,
    planStatus: options.planStatus !== false,
    delegation: options.delegation !== false,
    softLimit,
    compressLimit,
    hardLimit,
    compressionTool: typeof options.compressionTool === "string" ? options.compressionTool : "compress",
    maxPromptChars: positive(options.maxPromptChars, 16_000, 200_000),
    tempTtlHours: positive(options.tempTtlHours, 24, 48),
    nudgeCooldownMs: positive(options.nudgeCooldownMs, 600_000, 3_600_000),
  }
}

function resolveBank(explicit: unknown, fromEnv: string | undefined, template: string | undefined, projectName: string): string {
  const direct = typeof explicit === "string" ? explicit.trim() : (fromEnv ?? "").trim()
  if (direct) return direct
  if (!template) {
    throw new Error(
      "No Hindsight bank: set the plugin option `bank`, HINDSIGHT_BANK_ID, or a bankIdTemplate in ~/.hindsight/coding-agent.json",
    )
  }
  return expandBankTemplate(template, projectName)
}

function positive(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}
