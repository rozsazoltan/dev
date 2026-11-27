import assert from "node:assert/strict"
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createEvidence } from "../src/evidence.ts"

async function project() {
  const root = await mkdtemp(join(tmpdir(), "evidence-"))
  await mkdir(join(root, "docs"), { recursive: true })
  await writeFile(join(root, "docs", "plan.md"), "# Plan\n\nThe preset pins the commit.\n")
  return root
}

test("reports existing files with size and lead line", async () => {
  const root = await project()
  const [entry] = await createEvidence(root).inspect(["docs/plan.md"])
  assert.equal(entry.exists, true)
  assert.equal(entry.kind, "file")
  assert.match(entry.lead ?? "", /# Plan/)
})

test("reports a missing path without failing", async () => {
  const root = await project()
  const [entry] = await createEvidence(root).inspect(["docs/gone.md"])
  assert.equal(entry.exists, false)
  assert.equal(entry.error, "missing")
})

test("rejects paths outside the project root", async () => {
  const root = await project()
  const [entry] = await createEvidence(root).inspect(["../../etc/passwd"])
  assert.equal(entry.exists, true)
  assert.match(entry.error ?? "", /escapes the project root/)
})

test("reports symlinks without following them", async () => {
  const root = await project()
  await symlink("/etc/passwd", join(root, "link.md"))
  const [entry] = await createEvidence(root).inspect(["link.md"])
  assert.match(entry.error ?? "", /symlink/)
  assert.equal(entry.lead, undefined)
})
