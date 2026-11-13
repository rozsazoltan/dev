/** @jsxImportSource solid-js */
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Plugin, Slot, Style, type SlotMap } from "@opencode/plugin/gui"
import { Attachments, type AttachmentInfo, type AttachmentList, type SaveResult } from "./rpc.ts"

const CSS = `
.oca-button { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px;
  border: 1px solid var(--border-weak); border-radius: 6px; background: transparent; color: var(--text-base);
  font-size: 12px; cursor: pointer; }
.oca-button:hover { background: var(--surface-hover); }
.oca-count { color: var(--text-muted); }
.oca-dialog { display: flex; flex-direction: column; gap: 1px; min-width: 520px; max-height: 60vh; overflow: auto; }
.oca-title { font-weight: 600; margin-bottom: 8px; }
.oca-empty { color: var(--text-muted); font-size: 13px; padding: 12px 0; }
.oca-row { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 6px; }
.oca-row:hover { background: var(--surface-hover); }
.oca-line { display: flex; align-items: center; gap: 8px; }
.oca-name { font-size: 13px; }
.oca-meta { font-size: 11px; color: var(--text-muted); word-break: break-all; }
.oca-temp { color: var(--text-feedback-warning, var(--text-muted)); }
.oca-saved { color: var(--text-feedback-success, var(--text-muted)); }
.oca-actions { display: flex; gap: 6px; margin-top: 4px; }
.oca-action { font-size: 11px; padding: 2px 8px; border: 1px solid var(--border-weak); border-radius: 5px;
  background: transparent; color: var(--text-base); cursor: pointer; }
.oca-action:hover { background: var(--surface-hover); }
.oca-error { color: var(--text-feedback-error, var(--text-base)); font-size: 12px; }
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * GUI half: a session header button lists the conversation's attachments oldest first. Saving one opens the system
 * folder picker, asks for a file name, and the server half writes the bytes.
 */
export default Plugin.define({
  setup(ctx) {
    const [rows, setRows] = createSignal<readonly AttachmentInfo[]>([])
    const [directory, setDirectory] = createSignal("")
    const [failure, setFailure] = createSignal<string>()

    /** The routed session, read where a click acts so a switch never targets the previous one. */
    function session() {
      return ctx.sessions.current()
    }

    async function load(): Promise<void> {
      const current = session()
      if (!current) {
        setRows([])
        return
      }
      try {
        const answer = (await current.server.client.rpc(Attachments).list({ sessionID: current.id })) as AttachmentList
        setRows(answer.attachments)
        setDirectory(answer.directory)
        setFailure(undefined)
      } catch (error) {
        setFailure(message(error))
      }
    }

    createEffect(() => {
      const current = session()
      if (!current) return
      const stop = current.server.client.rpc(Attachments).events.on("changed", (event) => {
        if (event.data.sessionID === current.id) void load()
      })
      onCleanup(stop)
    })

    async function write(attachment: AttachmentInfo, target: string, overwrite: boolean): Promise<void> {
      const current = session()
      if (!current) return
      const answer = (await current.server.client.rpc(Attachments).save({
        sessionID: current.id,
        id: attachment.id,
        directory: target,
        name: attachment.name,
        overwrite,
      })) as SaveResult
      ctx.toast.show({ title: "Attachment saved", variant: "success" })
      void answer
      await load()
    }

    async function saveAs(attachment: AttachmentInfo): Promise<void> {
      const folder = ctx.desktop
        ? (await ctx.desktop.pick({ directory: true, title: "Save attachment to" }))[0]
        : directory()
      if (!folder) return

      const name = await ctx.dialogs.prompt({
        title: "File name",
        description: `Writes to ${folder}`,
        value: attachment.name,
      })
      if (!name?.trim()) return

      try {
        await write({ ...attachment, name: name.trim() }, folder, false)
      } catch (error) {
        if (!/already exists/i.test(message(error))) {
          await ctx.dialogs.alert({ title: "Save failed", description: message(error) })
          return
        }
        const replace = await ctx.dialogs.confirm({
          title: "Overwrite file?",
          description: `${folder}/${name.trim()} already exists.`,
          confirm: "Overwrite",
          danger: true,
        })
        if (!replace) return
        try {
          await write({ ...attachment, name: name.trim() }, folder, true)
        } catch (retry) {
          await ctx.dialogs.alert({ title: "Save failed", description: message(retry) })
        }
      }
    }

    function open(): void {
      void load()
      ctx.dialogs.open((dialog) => (
        <div class="oca-dialog">
          <div class="oca-title">Attachments</div>
          <Show when={failure()}>
            <div class="oca-error">{failure()}</div>
          </Show>
          <Show when={!failure() && rows().length === 0}>
            <div class="oca-empty">No attachments in this conversation yet.</div>
          </Show>
          <For each={rows()}>
            {(row) => (
              <div class="oca-row">
                <div class="oca-line">
                  <span class="oca-name">
                    {row.order}. {row.name}
                  </span>
                  <span class={row.status === "new" ? "oca-meta" : row.status === "temp" ? "oca-temp" : "oca-saved"}>
                    {statusLabel(row)}
                  </span>
                  <Show when={sizeLabel(row.bytes)}>
                    <span class="oca-meta">{sizeLabel(row.bytes)}</span>
                  </Show>
                </div>
                <Show when={row.path}>
                  <div class="oca-meta">{row.path}</div>
                </Show>
                <div class="oca-actions">
                  <button class="oca-action" onClick={() => void saveAs(row)}>
                    Save as…
                  </button>
                  <Show when={row.path && ctx.desktop}>
                    <button class="oca-action" onClick={() => void ctx.desktop?.reveal(row.path!)}>
                      Show in folder
                    </button>
                  </Show>
                  <Show when={row.path}>
                    <button class="oca-action" onClick={() => void ctx.system.copy(row.path!)}>
                      Copy path
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <div class="oca-actions">
            <button class="oca-action" onClick={dialog.close}>
              Close
            </button>
          </div>
        </div>
      ))
    }

    ctx.add(Style, CSS)
    ctx.add(Slot, {
      at: "session.header",
      order: 11,
      render: (input: SlotMap["session.header"]) => (
        <button class="oca-button" title="Files attached in this conversation" onClick={open}>
          Files <span class="oca-count">{rows().length}</span>
        </button>
      ),
    })
  },
})
