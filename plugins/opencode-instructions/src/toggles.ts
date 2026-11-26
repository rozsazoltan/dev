import type { Plugin } from "@opencode/plugin"

export const TOGGLE_STORAGE_KEY = "instruction-toggles"

export function normalizeInstructionPath(path: string): string {
  return process.platform === "win32" ? path.replace(/\\/g, "/").toLowerCase() : path
}

type ToggleStorage = Pick<Plugin.Context["storage"], "get" | "set">

export interface InstructionToggles {
  disabled: Set<string>
  builtin: boolean
}

export async function readToggles(storage: ToggleStorage): Promise<InstructionToggles> {
  const value = await storage.get(TOGGLE_STORAGE_KEY)
  if (value === undefined) return { disabled: new Set(), builtin: true }
  if (
    typeof value !== "object" ||
    value === null ||
    !("disabled" in value) ||
    !Array.isArray(value.disabled) ||
    !value.disabled.every((path) => typeof path === "string")
  ) {
    throw new Error("Invalid instruction toggle storage value")
  }
  const builtin = "builtin" in value ? value.builtin : true
  if (typeof builtin !== "boolean") {
    throw new Error("Invalid instruction toggle storage value")
  }
  return {
    disabled: new Set(value.disabled.map(normalizeInstructionPath)),
    builtin,
  }
}

export async function writeToggles(storage: ToggleStorage, toggles: InstructionToggles): Promise<void> {
  await storage.set(TOGGLE_STORAGE_KEY, {
    disabled: [...new Set([...toggles.disabled].map(normalizeInstructionPath))],
    builtin: toggles.builtin,
  })
}
