import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import plugin from "../src/index.ts"

const png = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`

function fakeContext() {
  const hooks = {}
  const tools = new Map()
  const context = {
    location: { directory: "/project", project: { canonical: "/project" } },
    session: {
      hook: async (name, callback) => {
        hooks[name] = callback
        return { dispose: async () => {} }
      },
    },
    tool: {
      transform: async (callback) => {
        callback({ add: (tool) => tools.set(tool.name, tool) })
        return { dispose: async () => {} }
      },
    },
  }
  return { context, hooks, tools }
}

test("exposes the plugin id and registers exactly one tool", async () => {
  const { context, tools } = fakeContext()
  const cleanup = await plugin.setup(context)
  assert.equal(plugin.id, "rozsazoltan.opencode-attachments")
  assert.deepEqual([...tools.keys()], ["attachment_to_file"])
  await cleanup?.()
})

test("capturing a prompt writes nothing; the tool writes on demand", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-attachments-plugin-test-"))
  try {
    const { context, hooks, tools } = fakeContext()
    await plugin.setup(context)

    await hooks.prompt({ sessionID: "ses_1", prompt: { text: "", files: [{ uri: png, name: "photo.png" }] } })
    assert.deepEqual(await readdir(dir), [], "capturing a prompt must not write files")

    const tool = tools.get("attachment_to_file")
    const result = await tool.execute(
      { path: join(dir, "assets"), name: "hero.png" },
      { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal },
    )

    const written = join(dir, "assets", "hero.png")
    assert.match(result.content, new RegExp(`Wrote ${written}`))
    assert.equal((await readFile(written)).toString(), "fake-png-bytes")
    assert.equal(result.metadata.mime, "image/png")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("an unknown session produces a clear error", async () => {
  const { context, tools } = fakeContext()
  await plugin.setup(context)

  const tool = tools.get("attachment_to_file")
  await assert.rejects(
    () =>
      tool.execute({}, { sessionID: "ses_missing", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal }),
    /no attachments/,
  )
})
