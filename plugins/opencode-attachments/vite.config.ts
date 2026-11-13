import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

/** Builds the desktop bundle: the one CommonJS file `./gui-experimental` exports. */
export default defineConfig({
  plugins: gui({ entry: "src/gui.tsx" }),
})
