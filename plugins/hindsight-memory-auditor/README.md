# Hindsight Memory Auditor

OpenCode V2 plugin plus a primary agent that audits one Hindsight memory bank against the current
repository and applies only the corrections you approve.

## What it does

- Captures full memory details through paginated bank reads, not a top-k recall sample. Reports
  repeated IDs, missing details, changing inventory and safety caps separately from semantic coverage.
- Uses conservative deterministic candidates: exact text plus compatible type, context, semantic
  dates and provenance; short fragments; derived memories with retired sources.
- Leaves judgement about truth to the agent and to repository evidence; nothing is retired from a
  heuristic alone.
- Assigns one check and exact target IDs to each read-only worker. The primary reconciles accepted
  structured findings, presents every issue in a table and reports per-ID/per-check coverage.
- Builds one cumulative, immutable remediation plan with full snapshots and a canonical payload hash.
- Requests fresh native once-only confirmation for the exact bank, plan and selected operation IDs;
  then rechecks preconditions, executes and verifies read-back content and state.

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
          "options": { "pageSize": 100, "maxMemories": 5000, "requestTimeoutMs": 15000 }
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

1. `memory_auditor_status` confirms the bank and confirmation boundary.
2. `memory_auditor_scan({ checks? })` persists an inventory revision and the required check set.
   Inventory collection is not semantic inspection. The default set covers tool logs, planning
   artifacts, agent narration, stale-current claims, duplicates, fragments, unverified claims,
   contradictions and stale derived content.
3. `memory_auditor_inventory({ runId?, offset?, limit?, state?, factType? })` pages that immutable
   revision, with full text/metadata, matching totals and `nextOffset`. `memory_auditor_inspect`
   reads current full detail, including available source links and history.
4. `memory_auditor_assign({ check, memoryIds, question, exclusions, referenceIds?, evidencePaths?,
   allowRecall?, allowGit?, runId? })` creates a bound worker. Assign at most 50 targets, one check,
   explicit reference IDs/paths, and a precise question. Only one assignment runs per primary session.
5. Workers use `memory_auditor_submit({ taskId, rows })` to account for every target. The plugin rejects
   other categories/targets, missing coverage, unsupported actions and unverified destructive claims.
   `memory_auditor_report({ runId? })` returns accepted rows and coverage. The primary presents all
   issues as a table with task/memory IDs, check, verdict, quoted claim, evidence, reason, confidence
   and proposed action. Clean, blocked and incomplete work is reported separately.
6. The primary verifies the evidence and builds a cumulative remediation plan. Inspect that exact
   plan with `memory_auditor_preview({ planId })`; approve its precise operation IDs.
7. `memory_auditor_apply({ planId, operationIds })` opens native once-only confirmation, then
   `memory_auditor_verify` reports observed results. A retry requires fresh confirmation.

Use `memory_auditor_report({ cancelTaskId })` to cancel a blocked assignment before assigning another.
Its unfinished targets remain incomplete; the cancelled worker loses tool access. Repository
evidence uses sandboxed `memory_auditor_evidence`, permitted file reads and `memory_auditor_git`.
The primary can use semantic recall and entity reads to choose explicit cross-memory checks.

## Remediation plans

`memory_auditor_propose({ kind, memoryIds, reason, planId?, text?, context? })` returns a plan without
writing to the bank. Pass the returned `planId` to the next proposal to append to the same lineage.
Each resulting version is immutable and independently reviewable. Previewing an existing plan does
not replace it with a heuristic-only plan; rescanning does not erase saved plans.

- `invalidate` retires valid source facts; `restore` restores invalidated source facts. Neither
  requires replacement text.
- `edit` requires one target and replacement `text`. It re-embeds the fact and may discard derived
  observations; other context is preserved.
- `merge` requires at least two sources and replacement `text`, with optional retention `context`.
  Source retirement begins only after exactly matching valid replacement text/context is read back.
  Missing or reworded extraction leaves sources valid and reports an unverified operation.
- Only `world` and `experience` facts are curatable. Observations are derived and read-only;
  report supported source-level remedies rather than promising direct edits.

## Tool visibility

The auditor tools are registered as direct tools, not Code Mode tools. The guard allows only the
auditor tool names, and a Code Mode call arrives as `execute`, which the auditor is not allowed to
use; registering directly keeps the tools reachable while the guard stays strict.

## Safety model

- There is no `auditOnly` mode switch. Reading is unrestricted within the audit's scope; every bank
  write requires fresh native once-only confirmation. A legacy `auditOnly` option has no effect.
- Confirmation binds the configured server/bank, full plan hash, exact operation IDs, primary
  session/tool call and a fresh nonce. Saved broad allows are forced back to `ask`; explicit denies
  remain denies. A matching native asked/replied event and successful permission assertion are both
  required. Missing events, rejection and cancellation fail closed.
- The bank is fixed by configuration; a model-supplied bank is rejected.
- Routes are built in code. There is no generic request tool, no bank deletion, no bulk clear, no
  document reprocessing, and no arbitrary REST call.
- Generic subagent/task execution is denied. The dedicated assignment tool persists the actual
  worker-session binding before prompting. Runtime restrictions follow both effective worker
  identity and bound sessions, preventing agent switching from restoring write access.
- The auditor may also read the official Hindsight pages through `hindsight_search_pages`,
  `hindsight_read_page` and `hindsight_list_pages`; their write tools and `hindsight_reflect` stay
  denied, so curation still runs through the plugin's plan and approval flow.
- Workers can read only assigned targets/references and explicitly permitted repository evidence;
  semantic recall and Git reads require explicit assignment grants. Workers can submit reports,
  but cannot propose/apply plans, delegate or write project files.
- Plans and audit runs persist per primary session. Plans are not silently evicted; human approval
  never persists or transfers between sessions.

## Known limitations

- The guard covers OpenCode tool execution. It cannot stop a *different* loaded plugin from acting
  on its own hooks, and it does not sandbox the model.
- Inventory is an observed revision, not an atomic database snapshot. Repeat-pass comparison detects
  many changes but cannot prove the server never changed between reads.
- The plugin restricts worker tool use and accepted findings, not private reasoning or arbitrary prose.
- Classification is heuristic plus agent reasoning; contradictions and outdated facts need human
  evidence, and the tool reports them instead of guessing.
- `edit` re-embeds a memory and drops its derived observations; a `merge` retains what Hindsight
  extracts from the submitted text. Split/reworded output deliberately fails exact replacement
  verification rather than authorizing retirement from a merely similar replacement.
- A merge may retain a replacement before a later source retirement fails. There is no inferred
  automatic retry: an existing merge document or already retired source needs explicit recovery and
  a new approved plan. The source snapshots remain in the original plan.
- Apply is check-then-write for every operation: Hindsight has no versioned precondition, so a
  concurrent writer that changes a target or a source between the read and the write is not
  detected. `restore` and `edit` are the recovery paths.
- Reprocessing a source document can recreate a retired fact; the plugin never reprocesses.
- Client normalization supports list `fact_type` and detail `type`. Requests and response-body reads
  are cancellable and bounded by `requestTimeoutMs`. Error bodies are not echoed to avoid leaking data.
- Automated fake-host/fake-bank checks do not establish live native approval or actual model-worker
  behavior. Validate those on the target OpenCode host after installing matching plugin and agent
  versions. A real-bank mutation demonstration requires separate explicit approval.

## Development

```bash
npm install
npm run typecheck
npm test
```
