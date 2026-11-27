import assert from "node:assert/strict"
import { test } from "node:test"
import { denyReason } from "../src/guard.ts"
import { describeBankPresence } from "../src/tools.ts"

test("other agents keep every tool", () => {
  assert.equal(denyReason("build", "shell"), undefined)
  assert.equal(denyReason(undefined, "edit"), undefined)
})

test("the auditor keeps reads and its own tools", () => {
  for (const tool of ["read", "glob", "grep", "memory_auditor_scan", "memory_auditor_inventory", "memory_auditor_assign", "memory_auditor_report", "memory_auditor_apply"]) {
    assert.equal(denyReason("memory-auditor", tool), undefined, tool)
  }
})

test("foreign names cannot inherit a registered tool's permission through suffix matching", () => {
  assert.match(denyReason("memory-auditor", "foreign.read"), /may not use/)
  assert.match(denyReason("memory-auditor-worker", "foreign.memory_auditor_submit"), /may not use/)
  assert.match(denyReason("memory-auditor", "hindsight-memory-auditor.shell") ?? "", /may not use/)
})

test("all generic delegation is blocked, including worker session continuation", () => {
  assert.match(denyReason("memory-auditor", "subagent", { agent: "memory-auditor-worker" }), /memory_auditor_assign/)
  assert.match(denyReason("memory-auditor", "task", { sessionID: "existing" }), /memory_auditor_assign/)
  assert.match(denyReason("memory-auditor", "subagent"), /memory_auditor_assign/)
  assert.equal(denyReason("build", "subagent", { agent: "build" }), undefined)
})

test("worker runtime allowlist excludes mutation and delegation wrappers", () => {
  for (const tool of ["memory_auditor_apply", "memory_auditor_propose", "memory_auditor_preview", "hindsight_ingest_document", "execute", "ctx_execute", "shell", "subagent", "task", "memory_auditor_inventory"]) {
    assert.match(denyReason("memory-auditor-worker", tool), /may not use/)
  }
  assert.equal(denyReason("memory-auditor-worker", "memory_auditor_submit"), undefined)
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
