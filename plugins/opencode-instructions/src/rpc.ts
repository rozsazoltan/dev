import { Rpc } from "@opencode/plugin/rpc"

export const Instructions = Rpc.define({
  id: "rozsazoltan.opencode-instructions",
  methods: {
    list: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                label: { type: "string" },
                exists: { type: "boolean" },
                enabled: { type: "boolean" },
                scope: { type: "string" },
              },
              required: ["path", "label", "exists", "enabled", "scope"],
              additionalProperties: false,
            },
          },
          builtin: { type: "boolean" },
        },
        required: ["files", "builtin"],
        additionalProperties: false,
      },
    },
    read: {
      input: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      } as const,
      output: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
        additionalProperties: false,
      },
    },
    set: {
      input: {
        type: "object",
        properties: { path: { type: "string" }, enabled: { type: "boolean" } },
        required: ["path", "enabled"],
        additionalProperties: false,
      } as const,
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    setBuiltin: {
      input: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
        additionalProperties: false,
      } as const,
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: { type: "object", properties: {}, additionalProperties: false },
    },
  },
})
