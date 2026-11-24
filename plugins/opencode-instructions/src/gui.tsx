import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Instructions } from "./rpc.ts"

type File = { path: string; label: string; exists: boolean; enabled: boolean }

const CSS = `
.oci-trigger { border: 0; background: transparent; color: var(--text-base); cursor: pointer; font: inherit; padding: 4px 8px; border-radius: 6px; }
.oci-trigger:hover { background: var(--surface-hover); }
.oci-trigger:focus-visible, .oci-switch:focus-visible, .oci-close:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.oci-dialog { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.oci-intro, .oci-muted { color: var(--text-muted); font-size: 12px; }
.oci-list { max-height: min(60vh, 560px); overflow: auto; }
.oci-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border-weak); }
.oci-label { font-weight: 500; overflow-wrap: anywhere; }
.oci-path { color: var(--text-muted); font-size: 11px; overflow-wrap: anywhere; margin-top: 3px; }
.oci-switch { border: 1px solid var(--border-weak); border-radius: 999px; min-width: 72px; padding: 6px 10px; color: var(--text-base); background: var(--surface-base); cursor: pointer; }
.oci-switch[aria-checked="true"] { color: var(--text-strong); }
.oci-error { color: var(--text-danger); overflow-wrap: anywhere; font-size: 12px; }
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

export default Plugin.define({
  setup(ctx) {
    const [files, setFiles] = createSignal<File[]>([])
    const [loading, setLoading] = createSignal(false)
    const [failure, setFailure] = createSignal("")
    const [busy, setBusy] = createSignal<string>()
    const [loaded, setLoaded] = createSignal<Context>()
    let request = 0
    let writeRequest = 0

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
        const result = await captured.server.client.rpc(Instructions).list({}, { location: captured.location }) as { files: File[] }
        if (id !== request || !matches(current(), captured)) return
        setFiles(result.files)
        setLoaded(captured)
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
      setLoading(!!captured)
      setFailure("")
      void load(captured)
      if (!captured) return
      const stop = captured.server.client.rpc(Instructions).events.on("changed", () => {
        if (matches(current(), captured)) void load(captured)
      })
      onCleanup(stop)
    })

    async function toggle(file: File) {
      const captured = current()
      if (!captured || !matches(loaded(), captured) || loading() || failure() || busy()) return
      const writeID = ++writeRequest
      setBusy(file.path)
      setFailure("")
      try {
        const result = await captured.server.client.rpc(Instructions).set(
          { path: file.path, enabled: !file.enabled },
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

    function open() {
      void load()
      ctx.dialogs.open((dialog) => (
        <ctx.ui.Dialog title="Instruction files" size="large" footer={<ctx.ui.Button size="small" onClick={dialog.close}>Close</ctx.ui.Button>}>
          <div class="oci-dialog">
            <p class="oci-intro">Choose which configured Markdown files guide this project.</p>
            <Show when={failure()}><div class="oci-error" role="alert">{failure()}</div></Show>
            <Show when={loading()}><div class="oci-muted" role="status">Loading instruction files…</div></Show>
            <Show when={!loading() && !failure() && files().length === 0}>
              <div class="oci-muted">No configured instruction files found.</div>
            </Show>
            <div class="oci-list">
              <For each={files()}>{(file) =>
                <div class="oci-file">
                  <div>
                    <div class="oci-label">{file.label}{!file.exists && <span class="oci-muted"> · missing</span>}</div>
                    <div class="oci-path">{file.path}</div>
                  </div>
                  <button
                    class="oci-switch"
                    type="button"
                    role="switch"
                    aria-checked={file.enabled}
                    aria-label={`${file.enabled ? "Disable" : "Enable"} ${file.label}`}
                    disabled={!!busy() || loading() || !!failure() || !matches(loaded(), current())}
                    onClick={() => void toggle(file)}
                  >{busy() === file.path ? "Saving…" : file.enabled ? "On" : "Off"}</button>
                </div>
              }</For>
            </div>
          </div>
        </ctx.ui.Dialog>
      ))
    }

    ctx.add(Style, CSS)
    ctx.add(Slot, {
      at: "session.header",
      order: 11,
      render: (_input: SlotMap["session.header"]) => (
        <button class="oci-trigger" type="button" onClick={open}>Instructions</button>
      ),
    })
  },
})
