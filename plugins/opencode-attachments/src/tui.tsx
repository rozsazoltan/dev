/** @jsxImportSource @opentui/solid */
import { basename, dirname, join } from "node:path"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { Attachments, type AttachmentInfo, type AttachmentList, type SaveResult } from "./rpc.ts"

const FALLBACK_TEXT = "#c9d1d9"
const FALLBACK_DIM = "#8b949e"
const FALLBACK_ACCENT = "#79c0ff"
const FALLBACK_WARN = "#e3b341"

/** First token path the active theme defines, so colours follow the user's theme. */
function themeColour(theme: unknown, ...paths: readonly string[][]): string | undefined {
  for (const path of paths) {
    let node: any = theme
    for (const key of path) node = node?.[key]
    if (typeof node === "string") return node
  }
  return undefined
}

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
 * TUI half: the session sidebar lists the conversation's attachments oldest first, and saving one writes its bytes
 * wherever the user types. Nothing here reads the disk; the server half owns the bytes.
 */
export default Plugin.define({
  id: "rozsazoltan.opencode-attachments.tui",
  setup(context) {
    const TEXT = themeColour(context.theme, ["text", "base"]) ?? FALLBACK_TEXT
    const DIM = themeColour(context.theme, ["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM
    const ACCENT = themeColour(context.theme, ["syntax", "function"], ["syntax", "variable"]) ?? FALLBACK_ACCENT
    const WARN = themeColour(context.theme, ["text", "feedback", "warning", "base"], ["syntax", "type"]) ?? FALLBACK_WARN

    const client = () => context.client.rpc(Attachments)
    const [rows, setRows] = createSignal<readonly AttachmentInfo[]>([])
    const [directory, setDirectory] = createSignal("")
    const [failure, setFailure] = createSignal<string>()

    async function load(sessionID: string): Promise<void> {
      if (!sessionID) {
        setRows([])
        return
      }
      try {
        const answer = (await client().list({ sessionID })) as AttachmentList
        setRows(answer.attachments)
        setDirectory(answer.directory)
        setFailure(undefined)
      } catch (error) {
        setFailure(message(error))
      }
    }

    async function write(sessionID: string, attachment: AttachmentInfo, target: string, overwrite: boolean): Promise<void> {
      const answer = (await client().save({
        sessionID,
        id: attachment.id,
        directory: dirname(target),
        name: basename(target),
        overwrite,
      })) as SaveResult
      context.ui.toast.show({ title: "Attachment saved", message: answer.path, variant: "success" })
      await load(sessionID)
    }

    /** Asks for a full path, then writes. An existing file is only replaced when the user confirms. */
    async function saveAs(sessionID: string, attachment: AttachmentInfo): Promise<void> {
      const suggested = attachment.path ?? join(directory() || ".", attachment.name)
      const answer = await context.ui.dialog.prompt({
        title: `Save ${attachment.name}`,
        description: "Full path of the file to write. Enter saves.",
        placeholder: suggested,
        value: suggested,
      })
      const target = answer?.trim()
      if (!target) return

      try {
        await write(sessionID, attachment, target, false)
      } catch (error) {
        if (!/already exists/i.test(message(error))) {
          context.ui.toast.show({ title: "Save failed", message: message(error), variant: "error" })
          return
        }
        const replace = await context.ui.dialog.confirm({
          title: "Overwrite file?",
          message: `${target} already exists.`,
          label: { confirm: "Overwrite" },
        })
        if (!replace) return
        try {
          await write(sessionID, attachment, target, true)
        } catch (retry) {
          context.ui.toast.show({ title: "Save failed", message: message(retry), variant: "error" })
        }
      }
    }

    function Sidebar(props: { readonly sessionID: () => string }) {
      createEffect(() => {
        void load(props.sessionID())
      })

      const watching = client().events.on("changed", (event) => {
        if (event.data.sessionID === props.sessionID()) void load(event.data.sessionID)
      })
      onCleanup(watching)

      const shown = () => rows().slice(-6).reverse()

      return (
        <Show when={props.sessionID()}>
          <box flexDirection="column" flexShrink={0}>
            <text wrapMode="none" fg={ACCENT}>
              <b>Attachments</b>
            </text>
            <Show when={failure()}>
              <text wrapMode="none" fg={WARN}>
                {failure()}
              </text>
            </Show>
            <Show when={!failure() && rows().length === 0}>
              <text wrapMode="none" fg={DIM}>
                none in this conversation
              </text>
            </Show>
            <For each={shown()}>
              {(row) => (
                <box flexDirection="column" flexShrink={0} onMouseUp={() => void saveAs(props.sessionID(), row)}>
                  <text wrapMode="none" fg={TEXT}>
                    <span style={{ fg: DIM }}>{row.order}. </span>
                    {row.name}
                  </text>
                  <text wrapMode="none" fg={row.status === "new" ? DIM : ACCENT}>
                    {"   "}
                    {statusLabel(row)}
                    {sizeLabel(row.bytes) ? ` · ${sizeLabel(row.bytes)}` : ""}
                    {row.path ? ` · ${row.path}` : ""}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      )
    }

    const sidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: (input) => <Sidebar sessionID={() => input.sessionID} />,
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "oc-attachments.list",
          title: "Attachments of this conversation",
          group: "Attachments",
          palette: true,
          slash: { name: "attachments" },
          async run() {
            const route = context.ui.router.current()
            if (route.type !== "session") {
              context.ui.toast.show({ title: "Attachments", message: "Open a session first.", variant: "info" })
              return
            }
            const sessionID = route.sessionID
            await load(sessionID)
            if (rows().length === 0) {
              context.ui.toast.show({ title: "Attachments", message: "No attachments in this conversation yet.", variant: "info" })
              return
            }
            const picked = await context.ui.dialog.select<AttachmentInfo | undefined>({
              title: "Attachments (oldest first)",
              placeholder: "Pick one to save",
              options: rows().map((row) => ({
                title: `${row.order}. ${row.name}`,
                value: row,
                description: row.path,
                footer: [statusLabel(row), sizeLabel(row.bytes)].filter(Boolean).join(" · "),
              })),
            })
            if (picked) await saveAs(sessionID, picked)
          },
        },
      ],
    }))

    return () => {
      sidebar?.()
    }
  },
})
