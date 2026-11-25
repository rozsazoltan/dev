import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Instructions } from "./rpc.ts"

type Scope = "builtin" | "project" | "global"
type File = { path: string; label: string; exists: boolean; enabled: boolean; scope: Scope }

const SCOPES: ReadonlyArray<{ scope: Scope; title: string; description: string }> = [
  { scope: "builtin", title: "Built-in", description: "Shipped with the plugin and available in every project." },
  { scope: "project", title: "Project", description: "From this project's configured sources, .agents/instructions, and .opencode/instructions." },
  { scope: "global", title: "Global", description: "From ~/.config/opencode/instructions and shared by every project." },
]

const CSS = `
.oci-trigger { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px;
  border: 1px solid var(--border-weak); border-radius: 6px; background: transparent; color: var(--text-base);
  font: inherit; font-size: 12px; cursor: pointer; }
.oci-trigger:hover { background: var(--surface-hover); }
.oci-trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.oci-dialog { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.oci-list { display: flex; flex-direction: column; gap: 16px; max-height: min(60vh, 560px); overflow: auto; }
.oci-section { display: flex; flex-direction: column; gap: 10px; }
.oci-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-bottom: 6px; border-bottom: 1px solid var(--border-weak); }
.oci-section-title { margin: 0; font-size: 13px; font-weight: 600; }
.oci-card { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid var(--border-weak); border-radius: 8px; }
.oci-card-text { display: flex; flex-direction: column; gap: 2px; }
.oci-card-title { font-size: 12px; font-weight: 500; }
.oci-empty { font-size: 12px; color: var(--text-muted); }
.oci-actions { display: flex; align-items: center; gap: 4px; }
.oci-label { font-weight: 500; overflow-wrap: anywhere; }
.oci-preview { max-height: min(70vh, 620px); overflow: auto; }
.oci-error { color: var(--text-danger); overflow-wrap: anywhere; font-size: 12px; }
.oci-note { color: var(--text-muted); font-size: 12px; }
`

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  // RPC failures reject with plain { type, message } objects, not Error instances.
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    const type = "type" in error && typeof error.type === "string" ? `${error.type}: ` : ""
    return `${type}${error.message}`
  }
  return String(error)
}

function isUnavailable(error: unknown): boolean {
  return (typeof error === "object" && error !== null && "type" in error && error.type === "rpc.unavailable")
    || message(error).includes("RPC is unavailable")
}

export default Plugin.define({
  setup(ctx) {
    const [files, setFiles] = createSignal<File[]>([])
    const [builtin, setBuiltin] = createSignal(true)
    const [loading, setLoading] = createSignal(false)
    const [failure, setFailure] = createSignal("")
    const [busy, setBusy] = createSignal<string>()
    const [loaded, setLoaded] = createSignal<Context>()
    const [viewing, setViewing] = createSignal<{ file: File; content?: string }>()
    const [readError, setReadError] = createSignal("")
    let request = 0
    let writeRequest = 0

    const groups = createMemo(() =>
      SCOPES.map((entry) => ({ ...entry, files: files().filter((file) => file.scope === entry.scope) })),
    )

    type Session = NonNullable<ReturnType<typeof ctx.sessions.current>>
    type Context = { server: Session["server"]; serverID: string; location: NonNullable<Session["location"]>; key: string }

    function current(): Context | undefined {
      const session = ctx.sessions.current()
      return session?.location ? { server: session.server, serverID: session.server.id, location: session.location, key: session.key } : undefined
    }

    function matches(a: Context | undefined, b: Context | undefined): boolean {
      return !!a && !!b && a.serverID === b.serverID && a.key === b.key && a.location === b.location
    }

    async function load(captured = current()) {
      if (captured && !matches(current(), captured)) return
      const id = ++request
      if (!captured) {
        setFiles([])
        setLoaded(undefined)
        setFailure("")
        setLoading(false)
        return
      }
      setLoaded(undefined)
      setLoading(true)
      setFailure("")
      try {
        const delays = [250, 500, 1000, 2000, 2000]
        for (let attempt = 0; ; attempt++) {
          try {
            const result = await captured.server.client.rpc(Instructions).list({}, { location: captured.location }) as { files: File[]; builtin: boolean }
            if (id !== request || !matches(current(), captured)) return
            setFiles(result.files)
            setBuiltin(result.builtin)
            setLoaded(captured)
            break
          } catch (error) {
            if (id !== request || !matches(current(), captured)) return
            if (!isUnavailable(error) || attempt >= delays.length) throw error
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
            if (id !== request || !matches(current(), captured)) return
          }
        }
      } catch (error) {
        if (id === request && matches(current(), captured)) setFailure(message(error))
      } finally {
        if (id === request && matches(current(), captured)) setLoading(false)
      }
    }

    createEffect(() => {
      const captured = current()
      request++
      setFiles([])
      setLoaded(undefined)
      setBusy(undefined)
      setViewing(undefined)
      setLoading(!!captured)
      setFailure("")
      void load(captured)
      if (!captured) return
      const stop = captured.server.client.rpc(Instructions).events.on("changed", () => {
        if (matches(current(), captured)) void load(captured)
      })
      onCleanup(stop)
    })

    function ready(): boolean {
      const captured = current()
      return !!captured && matches(loaded(), captured) && !loading() && !failure() && !busy()
    }

    async function toggle(file: File, enabled: boolean) {
      const captured = current()
      if (!captured || !ready()) return
      const writeID = ++writeRequest
      setBusy(file.path)
      setFailure("")
      try {
        const result = await captured.server.client.rpc(Instructions).set(
          { path: file.path, enabled },
          { location: captured.location },
        ) as { ok: boolean }
        if (!matches(current(), captured)) return
        if (!result.ok) throw new Error("Could not save instruction setting.")
        await load(captured)
      } catch (error) {
        if (matches(current(), captured)) setFailure(message(error))
      } finally {
        if (writeID === writeRequest) setBusy(undefined)
      }
    }

    async function toggleBuiltin(enabled: boolean) {
      const captured = current()
      if (!captured || !ready()) return
      const writeID = ++writeRequest
      setBusy("builtin")
      setFailure("")
      try {
        const result = await captured.server.client.rpc(Instructions).setBuiltin(
          { enabled },
          { location: captured.location },
        ) as { ok: boolean }
        if (!matches(current(), captured)) return
        if (!result.ok) throw new Error("Could not save instruction setting.")
        await load(captured)
      } catch (error) {
        if (matches(current(), captured)) setFailure(message(error))
      } finally {
        if (writeID === writeRequest) setBusy(undefined)
      }
    }

    async function show(file: File) {
      const captured = current()
      if (!captured || !matches(loaded(), captured)) return
      setReadError("")
      setFailure("")
      setViewing({ file })
      try {
        const result = await captured.server.client.rpc(Instructions).read({ path: file.path }, { location: captured.location }) as { content: string }
        if (!matches(current(), captured)) return
        setViewing({ file, content: result.content })
      } catch (error) {
        if (!matches(current(), captured)) return
        setReadError(message(error))
      }
    }

    function edit(path: string) {
      const session = ctx.sessions.current()
      if (!session?.location) return
      if (ctx.links.open({ href: path, exact: true, session })) return
      void ctx.desktop?.launch(path)
    }

    async function create(scope: "project" | "global") {
      const captured = current()
      if (!captured || !matches(loaded(), captured)) return
      const name = await ctx.dialogs.prompt({
        title: "New instruction file",
        description: scope === "global"
          ? "Created in ~/.config/opencode/instructions and shared by every project."
          : "Created in this project's .opencode/instructions directory.",
        placeholder: "file-name",
      })
      if (name === undefined || !name.trim() || !matches(current(), captured)) return
      setFailure("")
      setBusy("create")
      try {
        const result = await captured.server.client.rpc(Instructions).create(
          { scope, name },
          { location: captured.location },
        ) as { path: string }
        if (!matches(current(), captured)) return
        await load(captured)
        edit(result.path)
      } catch (error) {
        if (matches(current(), captured)) setFailure(message(error))
      } finally {
        if (matches(current(), captured)) setBusy(undefined)
      }
    }

    function open() {
      void load()
      ctx.dialogs.open((dialog) => (
        <ctx.ui.Dialog
          title={viewing() ? viewing()!.file.label : "Instruction files"}
          description={viewing() ? undefined : "Choose which Markdown files guide this project. Built-in files ship with the plugin; project and global files come from your own directories."}
          size="large"
          footer={
            <Show when={viewing()} fallback={<ctx.ui.Button size="small" onClick={dialog.close}>Close</ctx.ui.Button>}>
              <ctx.ui.Button variant="ghost" size="small" onClick={() => { setViewing(undefined); setReadError("") }}>Back</ctx.ui.Button>
              <ctx.ui.Button size="small" onClick={dialog.close}>Close</ctx.ui.Button>
            </Show>
          }
        >
          <Show when={viewing()} fallback={
            <div class="oci-dialog">
              <Show when={failure()}><div class="oci-error" role="alert">{failure()}</div></Show>
              <Show when={loading()}><div class="oci-note" role="status">Loading instruction files…</div></Show>
              <Show when={!loading() && !failure()}>
                <div class="oci-list">
                  <For each={groups()}>{(group) =>
                    <section class="oci-section">
                      <div class="oci-section-head">
                        <h3 class="oci-section-title">{group.title}</h3>
                        <Show when={group.scope !== "builtin"}>
                          <ctx.ui.Tooltip value="New instruction file">
                            <ctx.ui.IconButton
                              icon="plus"
                              label="New instruction file"
                              size="small"
                              disabled={!ready()}
                              onClick={() => group.scope !== "builtin" && void create(group.scope)}
                            />
                          </ctx.ui.Tooltip>
                        </Show>
                      </div>
                      <span class="oci-note">{group.description}</span>
                      <Show when={group.scope === "builtin"}>
                        <div class="oci-card">
                          <div class="oci-card-text">
                            <span class="oci-card-title">Use built-in instructions</span>
                            <span class="oci-note">Turn off to exclude every built-in file from the model context.</span>
                          </div>
                          <ctx.ui.Switch
                            label="Use built-in instructions"
                            hideLabel
                            checked={builtin()}
                            disabled={!ready()}
                            onChange={(enabled) => void toggleBuiltin(enabled)}
                          />
                        </div>
                      </Show>
                      <Show when={group.files.length > 0} fallback={<div class="oci-empty">No files in this section yet.</div>}>
                        <ctx.ui.SettingsSection>
                          <For each={group.files}>{(file) =>
                            <ctx.ui.SettingsRow
                              title={<span class="oci-label">{file.label}{!file.exists && <span class="oci-note"> · missing</span>}</span>}
                            >
                              <div class="oci-actions">
                                <ctx.ui.Button
                                  variant="ghost"
                                  size="small"
                                  disabled={!file.exists || !ready()}
                                  onClick={() => void show(file)}
                                >Show</ctx.ui.Button>
                                <Show when={file.scope !== "builtin"}>
                                  <ctx.ui.Tooltip value="Edit file">
                                    <ctx.ui.IconButton
                                      icon="pencil-line"
                                      label="Edit"
                                      size="small"
                                      disabled={!file.exists || !ready()}
                                      onClick={() => edit(file.path)}
                                    />
                                  </ctx.ui.Tooltip>
                                </Show>
                                <ctx.ui.Switch
                                  label={file.label}
                                  hideLabel
                                  checked={file.enabled}
                                  disabled={!ready() || (file.scope === "builtin" && !builtin())}
                                  onChange={(enabled) => void toggle(file, enabled)}
                                />
                              </div>
                            </ctx.ui.SettingsRow>
                          }</For>
                        </ctx.ui.SettingsSection>
                      </Show>
                    </section>
                  }</For>
                </div>
              </Show>
            </div>
          }>
            <div class="oci-dialog">
              <Show when={readError()}><div class="oci-error" role="alert">{readError()}</div></Show>
              <Show when={viewing()?.content === undefined && !readError()}><div class="oci-note" role="status">Loading…</div></Show>
              <Show when={viewing()?.content !== undefined}>
                <div class="oci-preview"><ctx.ui.Markdown text={viewing()!.content!} /></div>
              </Show>
            </div>
          </Show>
        </ctx.ui.Dialog>
      ))
    }

    ctx.add(Style, CSS)
    ctx.add(Slot, {
      at: "session.header",
      order: 11,
      render: (_input: SlotMap["session.header"]) => (
        <button class="oci-trigger" type="button" aria-label="Instructions" onClick={open}>Instructions</button>
      ),
    })
  },
})
