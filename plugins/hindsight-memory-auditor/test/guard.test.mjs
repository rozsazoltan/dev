import assert from "node:assert/strict"
import { test } from "node:test"
import { denyReason } from "../src/guard.ts"

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

test("the auditor loses writes, commands, delegation and network", () => {
  for (const tool of ["edit", "write", "patch", "shell", "bash", "task", "subagent", "webfetch", "websearch", "skill"]) {
    assert.match(denyReason("memory-auditor", tool) ?? "", /may not use/, tool)
  }
})
