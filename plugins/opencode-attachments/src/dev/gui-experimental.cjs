// The desktop half loads the built bundle, because a local plugin directory has no `exports` map to point at it.
module.exports = require("../../dist/gui-experimental.cjs")
