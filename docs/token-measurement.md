# Token and cost benchmarking

Measure total effort, not just a single terminal command. Repeat on a comparable repository state and model variant, track child agents, and record task quality.

## Scope A: Snip shell-filter savings

```bash
snip gain --json
snip gain --daily
snip gain --top 10
snip check -- git log -5
```

These reports estimate **shell output token savings only**, not the complete model conversation; filters sometimes bypass unsupported commands.

## Scope B: DCP context reductions

In supported builds, use `/dcp stats` and `/dcp context`. Record deduplicated/pruned content and compare session usage. DCP can influence prompt caching; fewer raw input tokens is not automatically lower billed cost.

## Scope C: OpenCode V2 usage

Inspect actual version-supported CLI functionality first:

```bash
opencode stats --help
opencode session --help
opencode api --help
```

Where supported, use `opencode stats --json` for model totals and session exports/API for the Orchestrator **plus** subagent sessions. If the Desktop owns the service, use a CLI connected to that service, not an independently launched WSL backend. Some OpenCode builds may differ in command/endpoint support.

## Suggested experiment

Run similar small, medium and large tasks from comparable Git starting points. Keep task and target model fixed. Compare:

- baseline with Snip/DCP disabled, normal delegation;
- Snip only;
- Snip + DCP;
- Snip + DCP + ask-before-delegation.

Record `input`, `output`, `reasoning`, `cache read/write`, `subagent count`, `tool retries`, wall time, measured cost and acceptance criteria. Parallel child usage belongs to the same task budget. Two agents each saving 20% can still use more tokens than one competent agent.

Record results in a personal spreadsheet or task note; this repository does not ship benchmark data or measurement scripts. Savings formula: `(baseline_total - optimized_total) / baseline_total`. Do not combine Snip and DCP savings percentages directly: they may reduce overlapping token sources.

## Manual analysis

For each comparable run, record date, task, model, configuration, parent/child tokens, cache usage, wall time, cost, retries, and validation outcome in a spreadsheet or your own notes. This repository intentionally supplies no scripts or benchmark fixtures.
