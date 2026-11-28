#!/usr/bin/env node
import { resolveConfig } from "./config.ts"
import { HindsightClient } from "./hindsight.ts"
import { MemoryManager } from "./memory.ts"

/**
 * Independent temporary-memory cleanup for a scheduler (cron/systemd timer) that runs while
 * OpenCode is closed. Dry run unless --apply, and deletion still requires temporaryCleanup.
 */
const args = new Set(process.argv.slice(2))
const dryRun = !args.has("--apply")
const projectDir = process.env.ORCHESTRATION_PROJECT_DIR ?? process.cwd()

try {
  const config = resolveConfig(undefined, process.env, projectDir)
  if (!config.temporaryMemory) {
    console.error("temporaryMemory is disabled; nothing to purge.")
    process.exit(0)
  }
  if (!dryRun && !config.temporaryCleanup) {
    console.error("temporaryCleanup is disabled; refusing to delete. Enable it only after reviewing the scheduler.")
    process.exit(2)
  }
  const manager = new MemoryManager(new HindsightClient(config), config)
  const result = await manager.purgeTemporary({ dryRun })
  console.log(JSON.stringify({ bank: config.bank, project: projectDir, ...result }, null, 2))
  process.exit(result.failed.length === 0 ? 0 : 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : "temporary purge failed")
  process.exit(1)
}
