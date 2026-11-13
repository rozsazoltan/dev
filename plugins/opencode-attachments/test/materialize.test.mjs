import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  AttachmentError,
  decodeAttachment,
  defaultFileName,
  existingFilePath,
  parseDataUrl,
  resolveTarget,
  sanitizeFileName,
  selectAttachment,
  writeAttachment,
} from "../src/materialize.ts"

const png = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`

test("parses and decodes base64 data URLs", () => {
  const parsed = parseDataUrl(png)
  assert.equal(parsed?.mime, "image/png")
  assert.equal(parsed?.base64, true)

  const decoded = decodeAttachment({ uri: png })
  assert.equal(decoded.mime, "image/png")
  assert.equal(decoded.bytes.toString(), "fake-png-bytes")
})

test("decodes percent-encoded text data URLs", () => {
  const decoded = decodeAttachment({ uri: "data:text/plain;charset=utf-8,hello%20world" })
  assert.equal(decoded.mime, "text/plain")
  assert.equal(decoded.bytes.toString(), "hello world")
})

test("rejects attachments that are not inline data", () => {
  assert.throws(() => decodeAttachment({ uri: "media:abc123" }), AttachmentError)
})

test("rejects attachments over the size limit", () => {
  const tooBig = `data:image/png;base64,${Buffer.alloc(64).toString("base64")}`
  assert.throws(() => decodeAttachment({ uri: tooBig }, 16), /16 byte limit/)
})

test("returns the path of file: attachments instead of copying", () => {
  assert.equal(existingFilePath("file:///tmp/notes.txt"), "/tmp/notes.txt")
  assert.equal(existingFilePath(png), undefined)
})

test("selects the only attachment by default", () => {
  const files = [{ uri: png, name: "photo.png" }]
  assert.equal(selectAttachment(files), files[0])
})

test("selects by index and by name", () => {
  const files = [
    { uri: png, name: "photo.png" },
    { uri: png, name: "notes.txt" },
  ]
  assert.equal(selectAttachment(files, "2"), files[1])
  assert.equal(selectAttachment(files, "notes.txt"), files[1])
  assert.throws(() => selectAttachment(files), /has 2 attachments/)
  assert.throws(() => selectAttachment(files, "9"), /No attachment matches/)
})

test("sanitizes names and falls back when nothing usable is left", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd")
  assert.equal(sanitizeFileName("a:b?.png"), "a_b_.png")
  assert.equal(sanitizeFileName(".."), "")
})

test("default file name uses the mime extension", () => {
  assert.equal(defaultFileName("image/png", 2, 1000), "attachment-2-1000.png")
  assert.equal(defaultFileName("application/x-unknown", 1, 1000), "attachment-1-1000")
})

test("resolves the default directory when no path is given", () => {
  const target = resolveTarget({
    baseDir: "/project",
    defaultDir: "/tmp/opencode/attachments/ses_1",
    fallbackName: "photo.png",
  })
  assert.equal(target, "/tmp/opencode/attachments/ses_1/photo.png")
})

test("resolves relative, absolute, directory and name combinations", () => {
  const base = { baseDir: "/project", defaultDir: "/tmp/default", fallbackName: "photo.png", home: "/home/me" }

  assert.equal(resolveTarget({ ...base, path: "assets/bg.png" }), "/project/assets/bg.png")
  assert.equal(resolveTarget({ ...base, path: "/srv/www/bg.png" }), "/srv/www/bg.png")
  assert.equal(resolveTarget({ ...base, path: "assets/", name: "hero.webp" }), "/project/assets/hero.webp")
  assert.equal(resolveTarget({ ...base, path: "assets", name: "hero.webp" }), "/project/assets/hero.webp")
  assert.equal(resolveTarget({ ...base, path: "~/pics" }), "/home/me/pics/photo.png")
  assert.equal(
    resolveTarget({ ...base, path: "/srv/www/old.png", name: "new.png" }),
    "/srv/www/new.png",
  )
  assert.equal(
    resolveTarget({ ...base, path: "/srv/www", isDirectory: () => true }),
    "/srv/www/photo.png",
  )
  assert.throws(() => resolveTarget({ ...base, name: ".." }), /Invalid file name/)
})

test("writes parent directories and refuses to overwrite by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-attachments-test-"))
  try {
    const target = join(dir, "nested", "deep", "bg.png")
    const written = await writeAttachment(target, Buffer.from("one"))
    assert.equal(written, target)
    assert.equal((await readFile(target)).toString(), "one")

    await assert.rejects(() => writeAttachment(target, Buffer.from("two")), /already exists/)

    await writeAttachment(target, Buffer.from("two"), { overwrite: true })
    assert.equal((await readFile(target)).toString(), "two")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
