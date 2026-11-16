/** @jsxImportSource solid-js */
import { For, Show, createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Attachments, type AttachmentInfo, type AttachmentList, type PreviewResult, type SaveResult } from "./rpc.ts"

type LayoutWithDirectoryPicker = {
  pickDirectory(options: { server: string; title: string }): Promise<string | undefined>
}

const CSS = `
.oca-button { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px;
  border: 1px solid var(--border-weak); border-radius: 6px; background: transparent; color: var(--text-base);
  font-size: 12px; cursor: pointer; }
.oca-button:hover { background: var(--surface-hover); }
.oca-count { color: var(--text-muted); }
.oca-loading { display: flex; min-height: 120px; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); }
.oca-dialog { display: flex; flex-direction: column; gap: 4px; }
.oca-row { display: grid; grid-template-columns: 68px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; padding: 10px 0; border-bottom: 1px solid var(--border-weak); }
.oca-preview-slot { display: grid; width: 68px; height: 68px; place-items: center; overflow: hidden; border-radius: 8px; }
.oca-kind { display: grid; width: 68px; height: 68px; place-items: center; border-radius: 8px;
  background: var(--surface-base); color: var(--text-muted); font-size: 10px; font-weight: 700; }
.oca-thumb { display: block; width: 68px; height: 68px; border-radius: 8px; object-fit: cover; }
.oca-info { display: flex; flex: 1 1 auto; flex-direction: column; gap: 3px; min-width: 0; }
.oca-name { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.oca-meta { overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.oca-preview { display: block; max-width: min(100%, 320px); max-height: 180px; margin-top: 6px; border-radius: 6px; object-fit: contain; }
.oca-video-thumb { display: block; width: 68px; height: 68px; border-radius: 8px; object-fit: cover; background: #000; }
.oca-play { position: relative; display: grid; width: 68px; height: 68px; padding: 0; place-items: center;
  overflow: hidden; border: 0; border-radius: 8px; background: var(--surface-base); color: var(--text-base); cursor: pointer; }
.oca-play-mark { position: absolute; display: grid; width: 24px; height: 24px; place-items: center; border-radius: 50%;
  background: color-mix(in srgb, var(--background-base) 78%, transparent); font-size: 12px; }
.oca-video-player { display: block; width: 100%; max-height: 70vh; border-radius: 6px; background: #000; }
.oca-actions { display: flex; flex: 0 0 auto; justify-content: flex-end; gap: 4px; }
.oca-action { display: grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 1px solid var(--border-weak);
  border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; }
.oca-action:hover { background: var(--surface-hover); color: var(--text-base); }
.oca-button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.oca-row button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.oca-preview-button { width: 68px; height: 68px; padding: 0; overflow: hidden; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
@media (max-width: 420px) {
  .oca-row { grid-template-columns: 60px minmax(0, 1fr) auto; gap: 7px; }
  .oca-preview-slot, .oca-kind, .oca-play, .oca-preview-button, .oca-thumb, .oca-video-thumb { width: 60px; height: 60px; }
  .oca-action { width: 26px; height: 28px; }
}
`

function statusLabel(attachment: AttachmentInfo): string {
  if (attachment.status === "saved") return "saved"
  if (attachment.status === "temp") return "temp"
  return "not written"
}

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createdAtLabel(value?: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function kindLabel(mime: string): string {
  if (mime.startsWith("image/")) return "IMG"
  if (mime.startsWith("video/")) return "VID"
  if (mime.startsWith("audio/")) return "AUD"
  return "FILE"
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * GUI half: a session header button lists the conversation's attachments newest first. Saving one opens the system
 * folder picker, asks for a file name, and the server half writes the bytes.
 */
export default Plugin.define({
  setup(ctx) {
    const [rows, setRows] = createSignal<readonly AttachmentInfo[]>([])
    const [directory, setDirectory] = createSignal("")
    const [failure, setFailure] = createSignal<string>()
    const [loading, setLoading] = createSignal(true)
    const [listReady, setListReady] = createSignal(false)
    const previews = new Set<string>()
    let previewVersion = 0
    let listRequest = 0
    let activeSessionKey: string | undefined
    let activeSessionLocation: NonNullable<ReturnType<typeof session>>["location"]

    function clearPreviews(): void {
      previewVersion++
      for (const url of previews) URL.revokeObjectURL(url)
      previews.clear()
    }

    /** The routed session, read where a click acts so a switch never targets the previous one. */
    function session() {
      return ctx.sessions.current()
    }

    type SaveContext = {
      id: string
      client: NonNullable<ReturnType<typeof session>>["server"]["client"]
      location: NonNullable<ReturnType<typeof session>>["location"]
    }

    function countLabel(): string | number {
      if (listReady()) return rows().length
      const current = session()
      return loading() && current && !current.pending && current.location ? "…" : ""
    }

    async function load(current = session()): Promise<void> {
      const request = ++listRequest
      if (!current || current.pending || !current.location) {
        setListReady(false)
        setLoading(Boolean(current))
        if (!current) {
          setRows([])
          setDirectory("")
          setFailure(undefined)
        }
        return
      }
      const location = current.location
      setLoading(true)
      try {
        const answer = (await current.server.client.rpc(Attachments).list({ sessionID: current.id }, { location })) as AttachmentList
        if (request !== listRequest || session()?.id !== current.id || session()?.location !== location) return
        setRows(answer.attachments)
        setDirectory(answer.directory)
        setFailure(undefined)
        setListReady(true)
      } catch (error) {
        if (request !== listRequest || session()?.id !== current.id || session()?.location !== location) return
        setFailure(message(error))
      } finally {
        if (request === listRequest && session()?.id === current.id && session()?.location === location) setLoading(false)
      }
    }

    createEffect(() => {
      const current = session()
      clearPreviews()
      const sessionKey = current?.key
      const sessionLocation = current?.location
      if (sessionKey !== activeSessionKey || sessionLocation !== activeSessionLocation) {
        activeSessionKey = sessionKey
        activeSessionLocation = sessionLocation
        setListReady(false)
      }
      if (!current || current.pending || !current.location) {
        setListReady(false)
        listRequest++
        setLoading(Boolean(current))
        if (!current) {
          setRows([])
          setDirectory("")
          setFailure(undefined)
        }
        return
      }
      setLoading(true)
      void load(current)
      const stop = current.server.client.rpc(Attachments).events.on("changed", (event) => {
        if (event.data.sessionID === current.id) void load()
      })
      onCleanup(stop)
    })

    async function write(
      attachment: AttachmentInfo,
      target: string,
      overwrite: boolean,
      current: SaveContext,
    ): Promise<void> {
      const answer = (await current.client.rpc(Attachments).save(
        {
          sessionID: current.id,
          id: attachment.id,
          directory: target,
          name: attachment.name,
          overwrite,
        },
        { location: current.location },
      )) as SaveResult
      ctx.toast.show({ title: "Attachment saved", variant: "success" })
      void answer
      void load()
    }

    async function saveAs(attachment: AttachmentInfo): Promise<void> {
      const current = session()
      if (!current || current.pending || !current.location) return
      const server = current.server
      const client = server.client
      const location = current.location
      const capturedAttachment = attachment
      const layout = ctx.layout as typeof ctx.layout & LayoutWithDirectoryPicker
      const folder = await layout.pickDirectory({ server: server.id, title: "Save attachment to" })
      if (!folder) return

      const name = await ctx.dialogs.prompt({
        title: "File name",
        description: `Writes to ${folder}`,
        value: capturedAttachment.name,
      })
      if (!name?.trim() || !/^[^/\\]+$/.test(name.trim())) return
      const chosenName = name.trim()
      const saveName = capturedAttachment.mime.startsWith("image/")
        ? chosenName.replace(/(\.[^./\\]+)?$/, `-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace("Z", "")}$1`)
        : chosenName
      const capturedSession: SaveContext = { id: current.id, client, location }

      try {
        await write({ ...capturedAttachment, name: saveName }, folder, false, capturedSession)
      } catch (error) {
        if (!/already exists/i.test(message(error))) {
          await ctx.dialogs.alert({ title: "Save failed", description: message(error) })
          return
        }
        const replace = await ctx.dialogs.confirm({
          title: "Overwrite file?",
          description: `${folder}/${saveName} already exists.`,
          confirm: "Overwrite",
          danger: true,
        })
        if (!replace) return
        try {
          await write({ ...capturedAttachment, name: saveName }, folder, true, capturedSession)
        } catch (retry) {
          await ctx.dialogs.alert({ title: "Save failed", description: message(retry) })
        }
      }
    }

    async function clear(): Promise<void> {
      const current = session()
      if (!current || rows().length === 0) return
      const confirmed = await ctx.dialogs.confirm({
        title: "Remove attached files?",
        description: "This removes files from the current conversation.",
        confirm: "Remove",
        danger: true,
      })
      if (!confirmed || session()?.id !== current.id || session()?.location !== current.location) return
      try {
        await current.server.client.rpc(Attachments).clear({ sessionID: current.id }, { location: current.location })
        clearPreviews()
        await load(current)
      } catch (error) {
        await ctx.dialogs.alert({ title: "Remove failed", description: message(error) })
      }
    }

    function open(): void {
      void load()
      ctx.dialogs.open((dialog) => {
        onCleanup(clearPreviews)
        return <ctx.ui.Dialog
          title="Attachments"
          size="normal"
          footer={<div class="oca-actions">
            <Show when={rows().length > 0}>
              <ctx.ui.Button size="small" variant="danger" onClick={() => void clear()} aria-label="Remove all files from this conversation">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v7m6-7v7" />
                </svg>
              </ctx.ui.Button>
            </Show>
            <ctx.ui.Button size="small" onClick={() => { clearPreviews(); dialog.close() }}>Close</ctx.ui.Button>
          </div>}
        >
          <div class="oca-dialog">
            <Show when={failure()}>
              <div>{failure()}</div>
            </Show>
            <Show when={loading()}>
              <div class="oca-loading" role="status"><ctx.ui.Loader size="large" />Loading attachments…</div>
            </Show>
            <Show when={!loading() && !failure() && rows().length === 0}>
              <div>No attachments in this conversation yet.</div>
            </Show>
            <For each={[...rows()].reverse()}>
              {(row) => (
                <div class="oca-row">
                  {(() => {
                    const [url, setUrl] = createSignal("")
                    const [busy, setBusy] = createSignal(false)
                    async function preview(): Promise<void> {
                      const current = session()
                      if (!current || busy() || url() || row.bytes > 25 * 1024 * 1024) return
                      const version = previewVersion
                      setBusy(true)
                      try {
                        const result = (await current.server.client.rpc(Attachments).preview(
                          { sessionID: current.id, id: row.id },
                          { location: current.location },
                        )) as PreviewResult
                        if (session()?.id !== current.id || session()?.location !== current.location || version !== previewVersion) return
                        const binary = atob(result.base64)
                        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
                        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: result.mime }))
                        previews.add(blobUrl)
                        setUrl(blobUrl)
                      } catch {
                        // Preview failures are non-fatal; retain the MIME icon.
                      } finally {
                        setBusy(false)
                      }
                    }
                    async function openMedia(): Promise<void> {
                      const current = session()
                      const source = url()
                      if (!current || !source) return
                      const version = previewVersion
                      try {
                        const response = await fetch(source)
                        const blob = await response.blob()
                        if (session()?.id !== current.id || session()?.location !== current.location || version !== previewVersion) return
                        const mediaUrl = URL.createObjectURL(blob)
                        ctx.dialogs.open((dialog) => {
                          let closed = false
                          const close = () => {
                            if (closed) return
                            closed = true
                            URL.revokeObjectURL(mediaUrl)
                            dialog.close()
                          }
                          onCleanup(() => URL.revokeObjectURL(mediaUrl))
                          return <ctx.ui.Dialog title={row.name} size="large" footer={<ctx.ui.Button size="small" onClick={close}>Close</ctx.ui.Button>}>
                            {row.mime.startsWith("video/") ?
                              <video class="oca-video-player" src={mediaUrl} controls preload="metadata" aria-label={`Playback of ${row.name}`} /> :
                              <img src={mediaUrl} alt={`Preview of ${row.name}`} style={{ "max-width": "100%", "max-height": "70vh", "object-fit": "contain" }} />}
                          </ctx.ui.Dialog>
                        })
                      } catch {
                        // The parent preview remains available if opening the media dialog fails.
                      }
                    }
                    if (row.mime.startsWith("image/") || row.mime.startsWith("video/")) untrack(() => void preview())
                    return (
                      <Show when={url()} fallback={
                        <span class="oca-preview-slot">
                          <span class="oca-kind" aria-label={`${kindLabel(row.mime)} file`}>{kindLabel(row.mime)}</span>
                          <Show when={busy()}><span class="oca-meta" role="status">Loading preview…</span></Show>
                        </span>
                      }>
                        <Show when={row.mime.startsWith("image/")} fallback={
                          <button class="oca-play" aria-label={`Play ${row.name}`} onClick={() => void openMedia()}>
                            <video class="oca-video-thumb" src={url()} muted preload="metadata" aria-hidden="true" />
                            <span class="oca-play-mark" aria-hidden="true">▶</span>
                          </button>
                        }>
                          <button class="oca-preview-button" aria-label={`Enlarge preview of ${row.name}`} onClick={() => void openMedia()}>
                            <img class="oca-thumb" src={url()} alt="" />
                          </button>
                        </Show>
                      </Show>
                    )
                  })()}
                  <div class="oca-info">
                    <span class="oca-name">
                      {row.order}. {row.name}
                    </span>
                    <span class="oca-meta">
                      {[sizeLabel(row.bytes), statusLabel(row), createdAtLabel(row.createdAt)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div class="oca-actions">
                    <button class="oca-action" title="Save as…" aria-label={`Save ${row.name} as`} onClick={() => void saveAs(row)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3" /></svg>
                    </button>
                    <Show when={row.path && ctx.desktop}>
                      <button class="oca-action" title="Show in folder" aria-label={`Show ${row.name} in folder`} onClick={() => void ctx.desktop?.reveal(row.path!)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z" /><path d="M14 13h5m-2-2 2 2-2 2" /></svg>
                      </button>
                    </Show>
                    <Show when={row.path}>
                      <button class="oca-action" title="Copy path" aria-label={`Copy path for ${row.name}`} onClick={() => void ctx.system.copy(row.path!)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </ctx.ui.Dialog>
      })
    }

    ctx.add(Style, CSS)
    ctx.add(Slot, {
      at: "session.header",
      order: 11,
      render: (input: SlotMap["session.header"]) => (
        <button class="oca-button" title="Files attached in this conversation" onClick={open}>
          Files <span class="oca-count">{countLabel()}</span>
        </button>
      ),
    })
  },
})
