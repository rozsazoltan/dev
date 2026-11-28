# OpenCode Orchestration Core

OpenCode V2 plugin that moves deterministic workflow rules out of prompt text and into infrastructure:
user-prompt registry, project and temporary memory policy, context-budget enforcement, plan
reporting, and delegation records.

Semantic judgement stays with the Orchestrator: it decides requirements, planning, delegation,
verification and what counts as sufficient evidence. The plugin owns capture, persistence,
validation, synchronization and the enforcement points the runtime actually supports.

## Install

1. Add the plugin to `opencode.json` (or `.opencode/opencode.json`):

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       {
         "package": "github:rozsazoltan/dev#<sha>::path:plugins/orchestration-core",
         "options": {}
       }
     ]
   }
   ```

2. The bank and server resolve exactly like the Hindsight integration:
   `bank` option → `HINDSIGHT_BANK_ID` → `bankIdTemplate` in `~/.hindsight/coding-agent.json`
   (`{gitProject}` expands to the project directory name). `apiUrl` falls back to the integration.
   An unknown template placeholder or a missing bank stops resolution instead of guessing.

3. Load the plugin once (`/reload` reloads config and plugins). A model, agent or grant change needs a
   new host generation.

## Tools

| Tool | Purpose |
| --- | --- |
| `orchestration_status` | Bank, enabled features, thresholds, request journal, active plan, limitations |
| `orchestration_requests` | List or read registry records (`user-prompt:` documents) |
| `orchestration_request_update` | Transition a request or its requirements with rationale and evidence |
| `orchestration_memory` | Recall project memory, retain verified project facts, retain/promote temporary findings |
| `orchestration_temp_purge` | Dry-run or delete expired temporary documents |
| `orchestration_context` | Measured active context, threshold and next compression action |
| `orchestration_plan` | Active planning-with-files plan, phases and completeness |
| `orchestration_delegation` | Record or list delegated lanes with read/write scopes |

All tools are registered directly (`codemode: false`) so they work as ordinary tools.

## Behaviour

### Prompt registry

`session.hook("prompt")` records a prompt before execution under the stable ID
`user-prompt:<session>:<message>`, with the original wording, per-requirement status, history and
redaction record. Obvious secrets (GitHub/AWS/Slack/API keys, bearer tokens, private keys,
credential assignments) are replaced before the text leaves the process and the redaction kinds are
recorded. The document is written to Hindsight with tags `type:user-prompt`,
`orchestration:registry` and `status:<status>`.

Writes are journaled locally first. A failed Hindsight write stays in the journal and is retried on
the next prompt and before every tool call; it is reported by `orchestration_status`, never hidden.

Transitions are validated: every change needs a rationale; completed/partially completed/blocked/
failed/not-applicable need evidence; cancellation needs explicit user withdrawal; supersession needs
the replacing request ID; reopening a terminal request needs `reopen`. Multi-part requests keep
per-requirement status, and the aggregate status is derived from them.

### Project memory

Durable facts use `project-memory:<slug>` IDs and require evidence or an explicit user decision.
Retaining an existing ID needs `replace: true`, and the previous text, evidence and timestamps stay
in the record's history. Proposals presented as completed, unverified agent reports, transient
progress, routine tool output and secrets are rejected by policy, not silently stored.

Recall uses Hindsight semantic search and filters out `user-prompt:` and `temporary:` documents.

### Temporary memory (disabled by default)

`temporary:<id>` documents carry `expires_at` (default 24h, maximum 48h), evidence, request links and
a verification flag. Retention requires `temporaryMemory: true`. Promotion writes the durable fact
first, reads it back, and only then deletes the temporary source; unverified temporary findings
cannot be promoted.

`orchestration_temp_purge` is a dry run by default. Deletion requires `temporaryCleanup: true` and is
intended for an independent scheduler:

```sh
node --experimental-strip-types src/purge-cli.ts          # dry run
node --experimental-strip-types src/purge-cli.ts --apply  # delete expired temporary docs
```

Deletion only touches documents tagged `type:temporary-memory` whose `expires_at` has passed; a
failed deletion is reported and retried by the next run.

### Context budget

The active context is the last completed assistant message's prompt tokens (`input + cache.read +
cache.write`), capped at an estimate of the text actually present in the session (four characters per
token). The cap wins when provider usage looks cumulative, and `detail` says so. No telemetry means
thresholds stay inactive and the plugin says so.

- `softLimit` (default 100000): prefers compression at the next closed chapter.
- `compressLimit` (default 150000): injects a synthetic reminder to checkpoint and compress.
- `hardLimit` (default 200000): `execute.before` blocks every tool except the compression tool and
  `orchestration_*` until the measured context drops. Off by default (`hardGate: false`): the message store
  is not the provider window, so a wrong reading must never block work. Enable it only where the reported
  usage is known to be per-request.

One reminder per anchor; the cooldown defaults to ten minutes.

### Orchestrator policy injection

The deterministic half of the Orchestrator rules is enforced by this plugin, so the append that carries
them does not need to repeat it. When OMO-Slim is installed — detected from
`oh-my-opencode-slim.json(c)` or a plugin entry naming it — the plugin appends one system part,
`description: "orchestration-policy"`, to every session request through `session.hook("context")`.

The injected text keeps only what code cannot enforce: what to delegate, how to judge a child's report,
how to interpret the user's scope, how to reconcile before final checks, and how to report. The OMO-Slim
append file is expected to become empty; a `policyText` option overrides the bundled text without editing
installed OMO-Slim files. The part is added once per request, so it never accumulates in the transcript.

### Planning and delegation

`orchestration_plan` reads `.planning/.active_plan` and the named `task_plan.md`. It never writes or
chooses a different plan; a missing pointer is reported with the available named plans.

`orchestration_delegation` records a lane with agent, description, write/read scope, dependencies
and status. Listing shows active lanes. This is a ledger and an anti-overlap check for declared
scopes, not a sandbox.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `bank` | integration template | Target bank; never guessed |
| `apiUrl` | integration / `http://127.0.0.1:8890` | Hindsight server |
| `token` | `HINDSIGHT_API_TOKEN` | Bearer token; http only on loopback |
| `requestTimeoutMs` | `15000` | Per-request timeout, including body reads |
| `promptRegistry` | `true` | Capture user prompts |
| `projectMemory` | `true` | Enable project memory tools |
| `temporaryMemory` | `false` | Enable temporary documents |
| `temporaryCleanup` | `false` | Allow real temporary deletion |
| `contextGuard` | `true` | Context measurement and threshold notices |
| `hardGate` | `false` | Block non-compression tools at the hard limit |
| `planStatus` | `true` | Report active plan |
| `delegation` | `true` | Record delegation lanes |
| `softLimit` / `compressLimit` / `hardLimit` | `100000` / `150000` / `200000` | Active-context thresholds |
| `compressionTool` | `compress` | Tool kept available at the hard limit |
| `maxPromptChars` | `16000` | Reserved for prompt truncation policy |
| `policyInjection` | `true` | Inject the Orchestrator policy when OMO-Slim is installed |
| `policyText` | bundled | Overrides the injected policy text |
| `tempTtlHours` | `24` | Default temporary TTL, maximum 48 |
| `nudgeCooldownMs` | `600000` | Minimum gap between budget reminders |

## Capability matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Prompt capture before execution | Supported | `session.hook("prompt")` |
| Distinguish synthetic/subagent prompts | Partial | Known markers filtered; origin is not fully documented |
| Durable outbox and retry | Supported | Local storage journal, retried on prompts and tool calls |
| Registry isolation from external recall | Partial | This plugin filters its own recall; the external Hindsight plugin can still recall registry text |
| Project memory replace with history | Supported | Same document ID, `update_mode: replace` |
| Temporary retention | Implemented, disabled | Needs a real scheduler and proven isolation |
| Independent expiry while OpenCode is closed | External | `purge-cli.ts` for cron/systemd |
| Context measurement | Supported when usage exists | Anchor on last assistant tokens; tail is estimated; an implausible anchor falls back to a window estimate |
| Policy injection | Supported | One system part per request when OMO-Slim is detected |
| Hard-limit blocking | Tool execution only | Text-only responses cannot be blocked |
| Plan status | Supported | Read-only |
| Delegation scope ledger | Supported | Declared scopes only; not a sandbox |
| GUI prompt display | Not implemented | No supported surface verified |

## Limitations

- The prompt hook's origin for synthetic and subagent prompts is not documented; capture filters the
  known synthetic markers and exposes the risk instead of claiming perfect exclusion.
- Tags alone do not prove recall isolation. The official Hindsight plugin's automatic recall can
  still surface registry or temporary text; keep temporary memory disabled until that is resolved.
- Registry writes trigger Hindsight extraction. Status transitions re-retain the document and may
  create new derived observations; the record itself stays authoritative.
- OMO-Slim detection is a heuristic over installed configuration; a renamed plugin entry is not detected.
- Context measurement depends on assistant token usage; before the first response, or without
  usage, no threshold is enforced.
- Blocking applies to tool calls. A model can still answer without tools above the hard limit.
- `orchestration_delegation` prevents overlapping writes only for scopes declared through the tool.
- Real OpenCode-host behavior (hook ordering, GUI submissions that never reach the server, event
  delivery) was not verified in this environment.

## Development

```bash
npm install
npm run typecheck
npm run purge-temporary
```
