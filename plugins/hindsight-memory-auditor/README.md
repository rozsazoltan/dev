# Hindsight Memory Auditor

OpenCode V2 plugin plus a primary agent that audits one Hindsight memory bank against the current
repository and applies only the corrections you approve.

## What it does

- Reads the whole bank through the Hindsight REST API, paginated, not a top-k recall sample.
- Triages deterministically: exact duplicates, fragments shorter than 40 characters, and observations whose source memories were retired (`STALE_DERIVED`).
- Leaves judgement about truth to the agent and to repository evidence; nothing is retired from a
  heuristic alone.
- Turns accepted findings into typed operations, each bound to a memory ID, its current text and a
  reason.
- Applies only the operation IDs you approve, re-reading each target first, then verifies the
  observed state.

Invalidation is the only mutation, and it is the reversible one: Hindsight keeps the memory
readable and restorable, and excludes it from recall and consolidation.

## Install

1. Copy the agent into the project where it should appear:

   ```bash
   mkdir -p .opencode/agents
   cp plugins/hindsight-memory-auditor/agent/memory-auditor.md .opencode/agents/
   ```

   Save it to `~/.config/opencode/agents/` instead to have it in every project.

2. Reference the plugin from `opencode.json` (or `opencode.jsonc`):

   ```jsonc
   {
     "plugins": [
       "rozsazoltan/dev#<sha>::path:plugins/hindsight-memory-auditor"
     ]
   }
   ```

3. Configure the bank. The bank is never guessed from the directory name:

   ```jsonc
   {
     "plugins": [
       {
         "path": "rozsazoltan/dev#<sha>::path:plugins/hindsight-memory-auditor",
         "options": {
           "apiUrl": "http://127.0.0.1:8890",
           "bank": "coding-agent::centos::dev",
           "auditOnly": true
         }
       }
     ]
   }
   ```

   `bank` may also come from `HINDSIGHT_BANK_ID` and the bearer token from `HINDSIGHT_API_TOKEN`.
   Without a bank the plugin refuses to start its tools instead of falling back to the first bank
   the server lists.

## Use

Select **Memory Auditor** in the agent picker, then:

1. `memory_auditor_status` — bank, server and whether mutations are enabled.
2. `memory_auditor_scan` — inventory and findings.
3. `memory_auditor_inspect` — one memory with provenance.
4. `memory_auditor_evidence` — whether cited repository paths exist (read-only, sandboxed to the project root); `memory_auditor_git` — branch/head info, working tree status or a bounded diff, without running a command.
5. `memory_auditor_preview` — typed plan with operation IDs.
6. Approve the exact IDs.
6. `memory_auditor_apply`, then `memory_auditor_verify`.

## Safety model

- `auditOnly` defaults to true; mutations require an explicit plan and explicit operation IDs.
- The bank is fixed by configuration; a model-supplied bank is rejected.
- Routes are built in code. There is no generic request tool, no bank deletion, no bulk clear, no
  document reprocessing, and no arbitrary REST call.
- The agent file denies edit, shell, subagent, webfetch, websearch and skill permissions, and the
  plugin's `execute.before` hook blocks any tool outside the auditor set for the `memory-auditor`
  agent, so prompt text is not the barrier.

## Known limitations

- The guard covers OpenCode tool execution. It cannot stop a *different* loaded plugin from acting
  on its own hooks, and it does not sandbox the model.
- There is no approval UI: approval is the caller passing explicit operation IDs to
  `memory_auditor_apply`. Plans persist in plugin storage (last five), so an approval survives a restart.
- Classification is heuristic plus agent reasoning; contradictions and outdated facts need human
  evidence, and the tool reports them instead of guessing.
- Editing a memory re-embeds it and drops its derived observations; reprocessing a source document
  can recreate a retired fact. The plugin never reprocesses, and it does not edit text.
- Verified against Hindsight's local server (`/v1/default/banks/...`). A remote deployment needs
  `apiUrl` and, if enforced, a token.

## Development

```bash
npm install
npm run typecheck
npm test
```
