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
  const handlers = new Map()
  const emitted = []
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
    rpc: {
      register: async (definition, implementation) => {
        for (const [name, handler] of Object.entries(implementation)) handlers.set(name, handler)
        return { events: { emit: async (name, data) => emitted.push({ name, data }) } }
      },
    },
  }
  return { context, hooks, tools, handlers, emitted }
}

test("exposes the plugin id and registers exactly one tool", async () => {
  const { context, tools } = fakeContext()
  const cleanup = await plugin.setup(context)
  assert.equal(plugin.id, "opencode-attachments")
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

test("list reports captured attachments in order and unwritten", async () => {
  const { context, hooks, handlers } = fakeContext()
  const cleanup = await plugin.setup(context)
  try {
    await hooks.prompt({
      sessionID: "ses_list",
      prompt: { text: "", files: [{ uri: png, name: "one.png" }, { uri: png, name: "two.png" }] },
    })

    const answer = await handlers.get("list")({ sessionID: "ses_list" })
    assert.deepEqual(
      answer.attachments.map((row) => [row.order, row.name, row.status]),
      [
        [1, "one.png", "new"],
        [2, "two.png", "new"],
      ],
    )
    assert.match(answer.directory, /attachments[\\/]ses_list$/)
  } finally {
    await cleanup?.()
  }
})

test("save writes into a chosen directory and marks the attachment saved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-attachments-rpc-test-"))
  const { context, hooks, handlers, emitted } = fakeContext()
  const cleanup = await plugin.setup(context)
  try {
    await hooks.prompt({ sessionID: "ses_save", prompt: { text: "", files: [{ uri: png, name: "photo.png" }] } })
    const [row] = (await handlers.get("list")({ sessionID: "ses_save" })).attachments

    const saved = await handlers.get("save")({ sessionID: "ses_save", id: row.id, directory: dir, name: "renamed.png" })
    assert.equal(saved.path, join(dir, "renamed.png"))
    assert.equal(saved.status, "saved")
    assert.equal((await readFile(saved.path)).toString(), "fake-png-bytes")
    assert.deepEqual(emitted.filter((event) => event.name === "changed").map((event) => event.data), [
      { sessionID: "ses_save" },
    ])

    const [after] = (await handlers.get("list")({ sessionID: "ses_save" })).attachments
    assert.equal(after.status, "saved")
    assert.deepEqual(after.files, [saved.path])
  } finally {
    await cleanup?.()
    await rm(dir, { recursive: true, force: true })
  }
})

test("save refuses to replace an existing file without overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opencode-attachments-rpc-test-"))
  const { context, hooks, handlers } = fakeContext()
  const cleanup = await plugin.setup(context)
  try {
    await hooks.prompt({ sessionID: "ses_overwrite", prompt: { text: "", files: [{ uri: png }] } })
    const [row] = (await handlers.get("list")({ sessionID: "ses_overwrite" })).attachments

    await handlers.get("save")({ sessionID: "ses_overwrite", id: row.id, directory: dir, name: "same.png" })
    await assert.rejects(
      () => handlers.get("save")({ sessionID: "ses_overwrite", id: row.id, directory: dir, name: "same.png" }),
      /already exists/,
    )
    const again = await handlers.get("save")({
      sessionID: "ses_overwrite",
      id: row.id,
      directory: dir,
      name: "same.png",
      overwrite: true,
    })
    assert.equal(again.path, join(dir, "same.png"))
  } finally {
    await cleanup?.()
    await rm(dir, { recursive: true, force: true })
  }
})

test("saving into the session temp directory reports temp", async () => {
  const { context, hooks, handlers } = fakeContext()
  const cleanup = await plugin.setup(context)
  try {
    await hooks.prompt({ sessionID: "ses_temp", prompt: { text: "", files: [{ uri: png, name: "shot.png" }] } })
    const [row] = (await handlers.get("list")({ sessionID: "ses_temp" })).attachments
    const { directory } = await handlers.get("list")({ sessionID: "ses_temp" })

    const saved = await handlers.get("save")({ sessionID: "ses_temp", id: row.id, directory, name: "shot.png" })
    assert.equal(saved.status, "temp")
    await rm(saved.path, { force: true })
  } finally {
    await cleanup?.()
  }
})

test("save rejects a relative directory", async () => {
  const { context, hooks, handlers } = fakeContext()
  const cleanup = await plugin.setup(context)
  try {
    await hooks.prompt({ sessionID: "ses_relative", prompt: { text: "", files: [{ uri: png }] } })
    const [row] = (await handlers.get("list")({ sessionID: "ses_relative" })).attachments
    await assert.rejects(
      () => handlers.get("save")({ sessionID: "ses_relative", id: row.id, directory: "relative/dir" }),
      /absolute directory/,
    )
  } finally {
    await cleanup?.()
  }
})
