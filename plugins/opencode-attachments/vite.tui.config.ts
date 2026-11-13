import { defineConfig } from "vite"

/** Builds the terminal bundle. The host and its renderer stay external: a second copy would break reactivity. */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/tui.tsx",
      formats: ["es"],
      fileName: () => "tui.js",
    },
    rollupOptions: {
      external: [/^@opencode\//, /^@opentui\//, /^solid-js/, /^node:/],
    },
  },
})
