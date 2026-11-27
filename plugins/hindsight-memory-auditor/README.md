# Hindsight Memory Auditor

OpenCode V2 plugin plus a primary agent that audits one Hindsight memory bank against the current
repository and applies only the corrections you approve.

## What it does

- Reads the whole bank through the Hindsight REST API, paginated, not a top-k recall sample.
- Triages deterministically: duplicates only when the trimmed text is byte-identical (case, punctuation, operators and quoted whitespace all distinguish facts), fragments shorter than 40 characters, and observations whose source memories were retired (`STALE_DERIVED`).
- Leaves judgement about truth to the agent and to repository evidence; nothing is retired from a
  heuristic alone.
- Proposes curated changes the heuristics cannot express: `merge` several memories into one retained fact and retire the sources, or `edit` one memory's text (which re-embeds it).
- Turns accepted findings into typed operations, each bound to a memory ID, its current text and a
  reason.
- Applies only the operation IDs you approve, re-reading each target first, then verifies the
  observed state.

Invalidation is the reversible mutation: Hindsight keeps the memory
readable and restorable, and excludes it from recall and consolidation.

## Install

1. Copy both agents into the project where they should appear:

   ```bash
   mkdir -p .opencode/agents
   cp plugins/hindsight-memory-auditor/agent/memory-auditor.md \
      plugins/hindsight-memory-auditor/agent/memory-auditor-worker.md .opencode/agents/
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

3. Configure the plugin. The bank and the server come from the same configuration the Hindsight
   coding-agent integration already uses (`~/.hindsight/coding-agent.json`), so no bank needs to be
   written by hand:

   ```jsonc
   {
     "plugins": [
       {
         "package": "rozsazoltan/dev#<sha>::path:plugins/hindsight-memory-auditor",
         "options": { "auditOnly": true }
       }
     ]
   }
   ```

   Resolution order for the bank: the `bank` option, then `HINDSIGHT_BANK_ID`, then
   `bankIdTemplate` from the integration config with `{gitProject}` expanded to the project
   directory name (`coding-agent::centos::{gitProject}` becomes `coding-agent::centos::dev`). An
   unknown template placeholder stops resolution instead of guessing. `apiUrl` falls back to the
   integration's `apiUrl`, and the bearer token comes from `HINDSIGHT_API_TOKEN`.
   `memory_auditor_status` reports whether the resolved bank actually exists on the server.

## Use

Select **Memory Auditor** in the agent picker, then:

1. `memory_auditor_status` — bank, server and whether mutations are enabled.
2. `memory_auditor_scan` — inventory and findings.
3. `memory_auditor_inspect` — one memory with provenance.
4. `memory_auditor_evidence` — whether cited repository paths exist (read-only, sandboxed to the project root); `memory_auditor_git` — branch/head info, working tree status or a bounded diff, without running a command.
5. `memory_auditor_recall` — semantic search by meaning; `memory_auditor_entities` — the subjects the bank tracks, so conflicts group by entity instead of wording.
6. `memory_auditor_preview` — typed plan with operation IDs; a duplicate operation also carries the keeper's ID and text.
6. Approve the exact IDs.
6. `memory_auditor_apply`, then `memory_auditor_verify`.

## Merge and edit

`memory_auditor_propose({ kind: "merge", memoryIds, text, context?, reason? })` builds a plan that
retains the new text under `document_id: memory-auditor-<operation>` and retires every source in the
same approved batch; a source that changed after planning aborts the whole operation.
`kind: "edit"` rewrites one memory's text and warns that Hindsight re-embeds it and drops derived
observations. Both are verified by reading back the retained document, the retired sources or the
rewritten text.

## Tool visibility

The auditor tools are registered as direct tools, not Code Mode tools. The guard allows only the
auditor tool names, and a Code Mode call arrives as `execute`, which the auditor is not allowed to
use; registering directly keeps the tools reachable while the guard stays strict.

## Safety model

- `auditOnly` defaults to true; mutations require an explicit plan and explicit operation IDs.
- The bank is fixed by configuration; a model-supplied bank is rejected.
- Routes are built in code. There is no generic request tool, no bank deletion, no bulk clear, no
  document reprocessing, and no arbitrary REST call.
- The agent file denies edit, shell, webfetch, websearch and skill permissions, and allows the
  `memory-auditor-worker` subagent only; the plugin's `execute.before` hook blocks any other tool,
  so prompt text is not the barrier.
- The auditor may also read the official Hindsight pages through `hindsight_search_pages`,
  `hindsight_read_page` and `hindsight_list_pages`; their write tools and `hindsight_reflect` stay
  denied, so curation still runs through the plugin's plan and approval flow.
- The worker is a separate read-only subagent: evidence checks on `read`, `glob`, `grep`,
  `memory_auditor_evidence` and `memory_auditor_git`, no mutations.

## Known limitations

- The guard covers OpenCode tool execution. It cannot stop a *different* loaded plugin from acting
  on its own hooks, and it does not sandbox the model.
- There is no approval UI: approval is the caller passing explicit operation IDs to
  `memory_auditor_apply`. Plans persist in plugin storage, last five per session, so an approval survives a restart and sessions stay isolated.
- Classification is heuristic plus agent reasoning; contradictions and outdated facts need human
  evidence, and the tool reports them instead of guessing.
- `edit` re-embeds a memory and drops its derived observations; a `merge` retains what Hindsight
  extracts from the submitted text, so the stored memories can be split or reworded, and verification
  checks that a valid replacement exists rather than that its text matches byte for byte.
- Apply is check-then-write for every operation: Hindsight has no versioned precondition, so a
  concurrent writer that changes a target or a source between the read and the write is not
  detected. `restore` and `edit` are the recovery paths.
- Reprocessing a source document can recreate a retired fact; the plugin never reprocesses.
- Verified against Hindsight's local server (`/v1/default/banks/...`). A remote deployment needs
  `apiUrl` and, if enforced, a token.

## Development

```bash
npm install
npm run typecheck
npm test
```
