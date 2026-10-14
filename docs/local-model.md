# Optional Unsloth local provider

Your supplied config includes two local Qwen3.6 27B variants (`pi-tune`, `pi-reasoning`) served over an OpenAI-compatible endpoint. A complete source-preserving but **inactive** example is in `profiles/optional-unsloth-provider.jsonc`.

To use: merge the `providers.unsloth` object into the active `config/opencode/opencode.jsonc` and set `UNSLOTH_BASE_URL` and `UNSLOTH_API_KEY` for the **actual server process**. The hostname, key, and endpoint are not included in this repository. Do not assume Windows Desktop can access a hostname used by WSL without checking firewall/loopback routing.

The custom parameters (`chat_template_kwargs`, `reasoningField`, `auto_heal_tool_calls`, etc.) were preserved as supplied, not claimed as universally supported by OpenCode V2/AI SDK; validate model behavior and server version before production use.

Because `opencode.jsonc` does not offer a general-purpose `extends` import, do not just symlink the optional provider file expecting an automatic deep merge. Merge it explicitly into your primary global file, or maintain a generated local config file with a documented script in your own private environment.
