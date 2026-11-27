import assert from "node:assert/strict"
import { test } from "node:test"
import { denyReason } from "../src/guard.ts"
import { describeBankPresence } from "../src/tools.ts"

test("other agents keep every tool", () => {
  assert.equal(denyReason("build", "shell"), undefined)
  assert.equal(denyReason(undefined, "edit"), undefined)
})

test("the auditor keeps reads and its own tools", () => {
  for (const tool of ["read", "glob", "grep", "memory_auditor_scan", "memory_auditor_apply"]) {
    assert.equal(denyReason("memory-auditor", tool), undefined, tool)
  }
})

test("qualified tool names still match the allowlist", () => {
  assert.equal(denyReason("memory-auditor", "hindsight-memory-auditor.memory_auditor_scan"), undefined)
  assert.match(denyReason("memory-auditor", "hindsight-memory-auditor.shell") ?? "", /may not use/)
})

test("the auditor may launch only its worker subagent", () => {
  assert.equal(denyReason("memory-auditor", "subagent", { agent: "memory-auditor-worker" }), undefined)
  assert.match(denyReason("memory-auditor", "subagent", { agent: "build" }) ?? "", /only launch/)
  assert.match(denyReason("memory-auditor", "subagent") ?? "", /only launch/)
  assert.equal(denyReason("build", "subagent", { agent: "build" }), undefined)
})

test("the auditor may read the official Hindsight pages", () => {
  for (const tool of ["hindsight_search_pages", "hindsight_read_page", "hindsight_list_pages"]) {
    assert.equal(denyReason("memory-auditor", tool), undefined, tool)
  }
  for (const tool of ["hindsight_ingest_document", "hindsight_capture_initiative", "hindsight_reflect"]) {
    assert.match(denyReason("memory-auditor", tool) ?? "", /may not use/, tool)
  }
})

test("the auditor loses writes, commands, delegation and network", () => {
  for (const tool of ["edit", "write", "patch", "shell", "bash", "webfetch", "websearch", "skill"]) {
    assert.match(denyReason("memory-auditor", tool) ?? "", /may not use/, tool)
  }
})

test("bank presence distinguishes a failed lookup from an empty list", () => {
  assert.match(describeBankPresence(null, "b"), /unknown/)
  assert.match(describeBankPresence([], "b"), /^NO/)
  assert.equal(describeBankPresence(["b"], "b"), "yes")
})
