import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

export interface PlanPhase {
  name: string
  status: "pending" | "in_progress" | "complete"
}

export interface PlanStatus {
  planId?: string
  planPath?: string
  phases: PlanPhase[]
  current?: string
  complete: boolean
  detail: string
}

/**
 * Reads the planning-with-files state instead of creating a parallel planning system. One owner
 * writes the plan; this is read-only and reports missing or malformed state instead of guessing.
 */
export async function readPlanStatus(projectDir: string): Promise<PlanStatus> {
  const planning = join(projectDir, ".planning")
  let planId: string | undefined
  try {
    planId = (await readFile(join(planning, ".active_plan"), "utf8")).trim() || undefined
  } catch {
    planId = undefined
  }
  if (!planId) {
    const candidates = await planDirectories(planning)
    return {
      phases: [],
      complete: false,
      detail: candidates.length === 0
        ? "No .planning/.active_plan and no named plan directory: planning status is unavailable."
        : `No .planning/.active_plan. Named plans present: ${candidates.join(", ")}; pin the plan instead of guessing.`,
    }
  }
  const planPath = join(planning, planId, "task_plan.md")
  let text: string
  try {
    text = await readFile(planPath, "utf8")
  } catch {
    return { planId, planPath, phases: [], complete: false, detail: "Active plan directory has no task_plan.md." }
  }
  const phases = parsePhases(text)
  const current = phases.find((phase) => phase.status === "in_progress")?.name
  return {
    planId,
    planPath,
    phases,
    current,
    complete: phases.length > 0 && phases.every((phase) => phase.status === "complete"),
    detail: phases.length === 0
      ? "No '### Phase' sections found in task_plan.md."
      : `${phases.filter((phase) => phase.status === "complete").length}/${phases.length} phases complete${current ? `; current: ${current}` : ""}.`,
  }
}

export function parsePhases(text: string): PlanPhase[] {
  const phases: PlanPhase[] = []
  let current: PlanPhase | undefined
  for (const line of text.split(/\r?\n/)) {
    const heading = /^###\s+Phase\b[^:]*:\s*(.+)$/i.exec(line.trim())
    if (heading) {
      current = { name: heading[1].trim(), status: "pending" }
      phases.push(current)
      continue
    }
    if (!current) continue
    const status = /\*\*Status:\*\*\s*(pending|in_progress|complete)/i.exec(line)
    if (status) current.status = status[1].toLowerCase() as PlanPhase["status"]
  }
  return phases
}

async function planDirectories(planning: string): Promise<string[]> {
  try {
    const entries = await readdir(planning, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

/** Newest plan file, only used for diagnostics such as staleness warnings. */
export async function newestPlan(projectDir: string): Promise<string | undefined> {
  const planning = join(projectDir, ".planning")
  try {
    const names = await planDirectories(planning)
    const stamped = await Promise.all(
      names.map(async (name) => {
        try {
          return { name, at: (await stat(join(planning, name, "task_plan.md"))).mtimeMs }
        } catch {
          return { name, at: 0 }
        }
      }),
    )
    stamped.sort((left, right) => right.at - left.at)
    return stamped[0]?.at ? stamped[0].name : undefined
  } catch {
    return undefined
  }
}
