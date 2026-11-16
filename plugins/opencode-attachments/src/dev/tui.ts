// The terminal half loads the built bundle, because a local plugin directory has no `exports` map to point at it.
// @ts-expect-error the built bundle carries no type declarations
export { default } from "../../dist/tui.js"
