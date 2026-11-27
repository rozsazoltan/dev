import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type { AuditorConfig } from "./types.ts"

const DEFAULT_URL = "http://127.0.0.1:8890"
const CODING_AGENTS_CONFIG = join(homedir(), ".hindsight", "coding-agent.json")

interface CodingAgentsConfig {
  apiUrl?: string
  bankIdTemplate?: string
}

/** Reads the official coding-agents config, which the Hindsight integration itself uses. */
export function readCodingAgentsConfig(path = CODING_AGENTS_CONFIG): CodingAgentsConfig | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    return value && typeof value === "object" ? (value as CodingAgentsConfig) : undefined
  } catch {
    return undefined
  }
}

/**
 * Expands the template the integration uses (`coding-agent::centos::{gitProject}`). Only the
 * documented `{gitProject}` placeholder is understood; anything else stops the resolution instead
 * of guessing a bank name.
 */
export function expandBankTemplate(template: string, projectName: string): string {
  // Match every braced token, not just alphabetic ones, so `{workspace_id}` cannot slip through.
  const unknown = template.match(/\{[^}]+\}/g)?.filter((token) => token !== "{gitProject}") ?? []
  if (unknown.length > 0) throw new Error(`Unsupported bankIdTemplate placeholder(s): ${unknown.join(", ")}`)
  // A callback keeps `$&` and similar sequences literal in the project name.
  return template.replace(/\{gitProject\}/g, () => projectName)
}

/**
 * Reads the plugin options. The bank is never guessed: without an explicit value the audit
 * refuses to start, because writing to the wrong bank is unrecoverable.
 */
export function resolveConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  projectName?: string,
  integrationPath = CODING_AGENTS_CONFIG,
): AuditorConfig {
  const options = raw ?? {}
  const integration = readCodingAgentsConfig(integrationPath)
  const apiUrl =
    typeof options.apiUrl === "string" ? options.apiUrl : typeof integration?.apiUrl === "string" ? integration.apiUrl : DEFAULT_URL
  const url = new URL(apiUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`apiUrl must be http or https, received ${url.protocol}`)
  }
  const token = typeof options.token === "string" ? options.token : env.HINDSIGHT_API_TOKEN
  // RFC 6750: a bearer token never travels in cleartext off the loopback interface.
  if (token && url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("A bearer token requires https unless apiUrl points at a loopback host")
  }
  const bank = resolveBank(options.bank, env.HINDSIGHT_BANK_ID, integration?.bankIdTemplate, projectName)
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    bank,
    token: token || undefined,
    // Mutations stay off until the operator opts in: every applied change is still approved per plan.
    auditOnly: options.auditOnly !== false,
    pageSize: positive(options.pageSize, 100, 500),
    maxMemories: positive(options.maxMemories, 5000, 50000),
  }
}

/** Option first, then the environment, then the integration's own template; never a guess. */
function resolveBank(explicit: unknown, fromEnv: string | undefined, template: string | undefined, projectName: string | undefined): string {
  const direct = typeof explicit === "string" ? explicit.trim() : (fromEnv ?? "").trim()
  if (direct) return direct
  if (!template) {
    throw new Error(
      "No Hindsight bank: set the plugin option `bank`, HINDSIGHT_BANK_ID, or a bankIdTemplate in ~/.hindsight/coding-agent.json",
    )
  }
  if (!projectName) throw new Error("Cannot expand bankIdTemplate: the project directory name is unknown")
  return expandBankTemplate(template, projectName)
}

function positive(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}

/** Rejects any bank that is not the configured one; model input never changes the target. */
export function assertBank(configured: string, requested: unknown): string {
  if (requested !== undefined && requested !== configured) {
    throw new Error(`Refusing to touch bank ${String(requested)}: this session is scoped to ${configured}`)
  }
  return configured
}
