import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { INSTRUCTION_MARKER, mergeInstructions, parseOptions, resolveSourcePath } from "../src/merge.ts"

const options = (sources, overrides = {}) => parseOptions({ sources, ...overrides })

async function sandbox(run) {
  const dir = await mkdtemp(join(tmpdir(), "instruction-merge-"))
  try { await run(dir) } finally { await rm(dir, { force: true, recursive: true }) }
}

test("merges files and directories in deterministic configured order", async () => sandbox(async (dir) => {
  const library = join(dir, "rules")
  await mkdir(library)
  await writeFile(join(dir, "AGENTS.md"), "Root instructions\n")
  await writeFile(join(library, "z.md"), "Z rules\n")
  await writeFile(join(library, "a.md"), "A rules\n")
  await writeFile(join(library, "ignored.txt"), "not instructions")
  const result = await mergeInstructions(options(["./AGENTS.md", "./rules"]), dir)
  assert.equal(result.files.length, 3)
  assert.equal(result.warnings.length, 0)
  assert.ok(result.text.startsWith(INSTRUCTION_MARKER))
  assert.ok(result.text.indexOf("Root instructions") < result.text.indexOf("A rules"))
  assert.ok(result.text.indexOf("A rules") < result.text.indexOf("Z rules"))
  assert.ok(!result.text.includes("not instructions"))
}))

test("deduplicates repeated source paths", async () => sandbox(async (dir) => {
  await writeFile(join(dir, "AGENTS.md"), "Once")
  const result = await mergeInstructions(options(["AGENTS.md", "AGENTS.md"]), dir)
  assert.equal(result.files.length, 1)
  assert.equal(result.text.match(/Once/g)?.length, 1)
}))

test("skips missing paths by default and enforces strict missing policy", async () => sandbox(async (dir) => {
  const result = await mergeInstructions(options(["missing.md"]), dir)
  assert.equal(result.text, "")
  assert.equal(result.warnings.length, 1)
  await assert.rejects(() => mergeInstructions(options(["missing.md"], { onMissing: "error" }), dir))
}))

test("rejects oversized files and binary-like content", async () => sandbox(async (dir) => {
  await writeFile(join(dir, "large.md"), "x".repeat(100))
  await writeFile(join(dir, "binary.md"), Buffer.from([65, 0, 66]))
  const result = await mergeInstructions(options(["large.md", "binary.md"], {
    maxFileBytes: 64,
    maxTotalBytes: 128,
  }), dir)
  assert.equal(result.files.length, 0)
  assert.equal(result.warnings.length, 2)
}))

test("does not follow symlinks", async () => sandbox(async (dir) => {
  await writeFile(join(dir, "real.md"), "Test")
  await symlink(join(dir, "real.md"), join(dir, "link.md"))
  const result = await mergeInstructions(options(["link.md"]), dir)
  assert.equal(result.files.length, 0)
  assert.equal(result.warnings.length, 1)
}))

test("resolves relative paths against project root and tilde against home", () => {
  assert.equal(resolveSourcePath("./rules.md", "/project"), "/project/rules.md")
  assert.equal(resolveSourcePath("~/rules.md", "/project", "/home/agent"), "/home/agent/rules.md")
})

test("validates plugin options", () => {
  assert.throws(() => parseOptions({ sources: [] }))
  assert.throws(() => parseOptions({ sources: ["a.md"], onMissing: "bad" }))
  assert.throws(() => parseOptions({ sources: ["a.md"], maxFileBytes: -1 }))
  assert.throws(() => parseOptions({ sources: ["a.md"], maxFileBytes: 99999999 }))
  assert.deepEqual(options(["a.md"]).sources, ["a.md"])
})
