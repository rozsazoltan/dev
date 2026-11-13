import { basename, dirname, join } from "node:path";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Plugin } from "@opencode/plugin/tui";
import { Rpc } from "@opencode/plugin/rpc";
import { jsx, jsxs } from "@opentui/solid/jsx-runtime";
/**
* The contract both UI halves call. Plain JSON Schema keeps this module free of Effect, because the GUI bundle may
* only import modules the app already provides.
*/
var Attachments = Rpc.define({
	id: "opencode-attachments",
	methods: {
		list: {
			input: {
				type: "object",
				properties: { sessionID: { type: "string" } },
				required: ["sessionID"],
				additionalProperties: false
			},
			output: {
				type: "object",
				properties: {
					attachments: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								order: { type: "integer" },
								name: { type: "string" },
								mime: { type: "string" },
								bytes: { type: "integer" },
								status: {
									type: "string",
									enum: [
										"new",
										"temp",
										"saved"
									]
								},
								path: { type: "string" },
								files: {
									type: "array",
									items: { type: "string" }
								}
							},
							required: [
								"id",
								"order",
								"name",
								"mime",
								"bytes",
								"status",
								"files"
							],
							additionalProperties: false
						}
					},
					directory: { type: "string" }
				},
				required: ["attachments", "directory"],
				additionalProperties: false
			}
		},
		save: {
			input: {
				type: "object",
				properties: {
					sessionID: { type: "string" },
					id: { type: "string" },
					directory: {
						type: "string",
						description: "Absolute destination directory."
					},
					name: {
						type: "string",
						description: "File name in that directory."
					},
					overwrite: { type: "boolean" }
				},
				required: [
					"sessionID",
					"id",
					"directory"
				],
				additionalProperties: false
			},
			output: {
				type: "object",
				properties: {
					path: { type: "string" },
					status: {
						type: "string",
						enum: ["temp", "saved"]
					}
				},
				required: ["path", "status"],
				additionalProperties: false
			}
		}
	},
	events: { changed: { schema: {
		type: "object",
		properties: { sessionID: { type: "string" } },
		required: ["sessionID"],
		additionalProperties: false
	} } }
});
// src/tui.tsx
/** @jsxImportSource @opentui/solid */
var FALLBACK_TEXT = "#c9d1d9";
var FALLBACK_DIM = "#8b949e";
var FALLBACK_ACCENT = "#79c0ff";
var FALLBACK_WARN = "#e3b341";
/** First token path the active theme defines, so colours follow the user's theme. */
function themeColour(theme, ...paths) {
	for (const path of paths) {
		let node = theme;
		for (const key of path) node = node?.[key];
		if (typeof node === "string") return node;
	}
}
function statusLabel(attachment) {
	if (attachment.status === "saved") return "saved";
	if (attachment.status === "temp") return "temp";
	return "not written";
}
function sizeLabel(bytes) {
	if (bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
function message(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* TUI half: the session sidebar lists the conversation's attachments oldest first, and saving one writes its bytes
* wherever the user types. Nothing here reads the disk; the server half owns the bytes.
*/
var tui_default = Plugin.define({
	id: "opencode-attachments.tui",
	setup(context) {
		const TEXT = themeColour(context.theme, ["text", "base"]) ?? FALLBACK_TEXT;
		const DIM = themeColour(context.theme, ["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM;
		const ACCENT = themeColour(context.theme, ["syntax", "function"], ["syntax", "variable"]) ?? FALLBACK_ACCENT;
		const WARN = themeColour(context.theme, [
			"text",
			"feedback",
			"warning",
			"base"
		], ["syntax", "type"]) ?? FALLBACK_WARN;
		const client = () => context.client.rpc(Attachments);
		const [rows, setRows] = createSignal([]);
		const [directory, setDirectory] = createSignal("");
		const [failure, setFailure] = createSignal();
		async function load(sessionID) {
			if (!sessionID) {
				setRows([]);
				return;
			}
			try {
				const answer = await client().list({ sessionID });
				setRows(answer.attachments);
				setDirectory(answer.directory);
				setFailure(void 0);
			} catch (error) {
				setFailure(message(error));
			}
		}
		async function write(sessionID, attachment, target, overwrite) {
			const answer = await client().save({
				sessionID,
				id: attachment.id,
				directory: dirname(target),
				name: basename(target),
				overwrite
			});
			context.ui.toast.show({
				title: "Attachment saved",
				message: answer.path,
				variant: "success"
			});
			await load(sessionID);
		}
		/** Asks for a full path, then writes. An existing file is only replaced when the user confirms. */
		async function saveAs(sessionID, attachment) {
			const suggested = attachment.path ?? join(directory() || ".", attachment.name);
			const target = (await context.ui.dialog.prompt({
				title: `Save ${attachment.name}`,
				description: "Full path of the file to write. Enter saves.",
				placeholder: suggested,
				value: suggested
			}))?.trim();
			if (!target) return;
			try {
				await write(sessionID, attachment, target, false);
			} catch (error) {
				if (!/already exists/i.test(message(error))) {
					context.ui.toast.show({
						title: "Save failed",
						message: message(error),
						variant: "error"
					});
					return;
				}
				if (!await context.ui.dialog.confirm({
					title: "Overwrite file?",
					message: `${target} already exists.`,
					label: { confirm: "Overwrite" }
				})) return;
				try {
					await write(sessionID, attachment, target, true);
				} catch (retry) {
					context.ui.toast.show({
						title: "Save failed",
						message: message(retry),
						variant: "error"
					});
				}
			}
		}
		function Sidebar(props) {
			createEffect(() => {
				load(props.sessionID());
			});
			const watching = client().events.on("changed", (event) => {
				if (event.data.sessionID === props.sessionID()) load(event.data.sessionID);
			});
			onCleanup(watching);
			const shown = () => rows().slice(-6).reverse();
			return /* @__PURE__ */ jsx(Show, {
				when: props.sessionID(),
				children: /* @__PURE__ */ jsxs("box", {
					flexDirection: "column",
					flexShrink: 0,
					children: [
						/* @__PURE__ */ jsx("text", {
							wrapMode: "none",
							fg: ACCENT,
							children: /* @__PURE__ */ jsx("b", { children: "Attachments" })
						}),
						/* @__PURE__ */ jsx(Show, {
							when: failure(),
							children: /* @__PURE__ */ jsx("text", {
								wrapMode: "none",
								fg: WARN,
								children: failure()
							})
						}),
						/* @__PURE__ */ jsx(Show, {
							when: !failure() && rows().length === 0,
							children: /* @__PURE__ */ jsx("text", {
								wrapMode: "none",
								fg: DIM,
								children: "none in this conversation"
							})
						}),
						/* @__PURE__ */ jsx(For, {
							each: shown(),
							children: (row) => /* @__PURE__ */ jsxs("box", {
								flexDirection: "column",
								flexShrink: 0,
								onMouseUp: () => void saveAs(props.sessionID(), row),
								children: [/* @__PURE__ */ jsxs("text", {
									wrapMode: "none",
									fg: TEXT,
									children: [/* @__PURE__ */ jsxs("span", {
										style: { fg: DIM },
										children: [row.order, ". "]
									}), row.name]
								}), /* @__PURE__ */ jsxs("text", {
									wrapMode: "none",
									fg: row.status === "new" ? DIM : ACCENT,
									children: [
										"   ",
										statusLabel(row),
										sizeLabel(row.bytes) ? ` · ${sizeLabel(row.bytes)}` : "",
										row.path ? ` · ${row.path}` : ""
									]
								})]
							})
						})
					]
				})
			});
		}
		const sidebar = context.ui.slot({
			prepend: "sidebar.content",
			render: (input) => /* @__PURE__ */ jsx(Sidebar, { sessionID: () => input.sessionID })
		});
		context.keymap.layer(() => ({
			mode: "global",
			commands: [{
				id: "oc-attachments.list",
				title: "Attachments of this conversation",
				group: "Attachments",
				palette: true,
				slash: { name: "attachments" },
				async run() {
					const route = context.ui.router.current();
					if (route.type !== "session") {
						context.ui.toast.show({
							title: "Attachments",
							message: "Open a session first.",
							variant: "info"
						});
						return;
					}
					const sessionID = route.sessionID;
					await load(sessionID);
					if (rows().length === 0) {
						context.ui.toast.show({
							title: "Attachments",
							message: "No attachments in this conversation yet.",
							variant: "info"
						});
						return;
					}
					const picked = await context.ui.dialog.select({
						title: "Attachments (oldest first)",
						placeholder: "Pick one to save",
						options: rows().map((row) => ({
							title: `${row.order}. ${row.name}`,
							value: row,
							description: row.path,
							footer: [statusLabel(row), sizeLabel(row.bytes)].filter(Boolean).join(" · ")
						}))
					});
					if (picked) await saveAs(sessionID, picked);
				}
			}]
		}));
		return () => {
			sidebar?.();
		};
	}
});
export { tui_default as default };
