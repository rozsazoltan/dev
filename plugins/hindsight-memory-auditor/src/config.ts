import type { AuditorConfig } from "./types.ts"

const DEFAULT_URL = "http://127.0.0.1:8890"

/**
 * Reads the plugin options. The bank is never guessed: without an explicit value the audit
 * refuses to start, because writing to the wrong bank is unrecoverable.
 */
export function resolveConfig(raw: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv = process.env): AuditorConfig {
  const options = raw ?? {}
  const apiUrl = typeof options.apiUrl === "string" ? options.apiUrl : DEFAULT_URL
  const url = new URL(apiUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`apiUrl must be http or https, received ${url.protocol}`)
  }
  const token = typeof options.token === "string" ? options.token : env.HINDSIGHT_API_TOKEN
  // RFC 6750: a bearer token never travels in cleartext off the loopback interface.
  if (token && url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("A bearer token requires https unless apiUrl points at a loopback host")
  }
  const bank = typeof options.bank === "string" ? options.bank.trim() : (env.HINDSIGHT_BANK_ID ?? "").trim()
  if (!bank) throw new Error("A Hindsight bank must be configured: set the plugin option `bank` or HINDSIGHT_BANK_ID")
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
