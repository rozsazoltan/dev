import { Plugin } from "@opencode/plugin"
import plugin from "../index.ts"

/**
 * Development entry: the same server half under a distinct id, so this checkout can run next to an installed copy.
 * `.opencode/opencode.json` points at this directory instead of the package root.
 */
export default Plugin.define({
  id: "opencode-attachments-dev",
  setup: plugin.setup,
})
