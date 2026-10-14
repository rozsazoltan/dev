# Tool inventory (review manually)

Status is **desired / illustrative** unless explicitly confirmed with runtime commands. Do not infer that a package is installed because it appears here. Edit this table when you change dependencies. Keep secret values out of it.

| Name | Type | Scope | Desired status | What enables it | Notes |
|---|---|---|---|---|---|
| oh-my-opencode-slim@2 | OpenCode plugin | Global | Enabled | `plugins` | Owns specialist agents and bundled skills |
| opencode-planning-with-files@1 | OpenCode plugin | Global | Enabled | `plugins` | Requires separate `planning-with-files` skill |
| planning-with-files | Skill | Global | Install separately | `npx skills add ... -g` | PWF tools are plugin functions |
| @tarquinen/opencode-dcp | OpenCode plugin | Global | Enabled | `plugins` | Tracks compress/pruning, not shell output |
| opencode-snip | OpenCode plugin | Global | Enabled | `plugins` | Requires `snip` binary on OpenCode server PATH |
| snip | CLI | Windows and/or WSL | Install separately | mise or bin | Shell output savings only |
| GitHub | Remote MCP | Global | Enabled after credentials | `OPENCODE_GITHUB_TOKEN` | Least-privilege token; protect secrets |
| Context7 | Slim-managed MCP | Librarian | Available via Slim | `librarian.mcps` | Do not also duplicate external config |
| gh_grep | Slim-managed MCP | Librarian | Available via Slim | `librarian.mcps` | Code search |
| Laravel Boost | Local MCP | Laravel apps | Optional | app `composer require` + install | Each app uses its own directory |
| Playwright | MCP or CLI | Vue/UX projects | Optional | local project config | Prefer CLI where lower overhead |
| simplify | Slim bundled skill | Oracle | Available via Slim | `oracle.skills` | No separate folder required |
| deepwork | Slim command | On-demand | Command only | `/deepwork` | Auto skill disabled deliberately |
| frontend-design | Third-party skill | Optional global/local | Not installed by repo | APM | Confirm availability before adding |
| custom Tauri review | Owned skill | Project | Template only | copy to `.opencode/skills` | Security boundary checks |

## Inventory maintenance

- `opencode plugin list` shows plugin state in supported CLI builds.
- `opencode debug config` helps inspect the merged configuration (check `--help` in installed version).
- `opencode api GET /api/skill` may require connecting to the **already-running** Desktop service; see [troubleshooting](../docs/troubleshooting.md).
- `snip gain --json` reports shell-output filtering metrics; it is not the same as model usage.
- `apm.yml` / generated `apm.lock.yaml` track APM dependencies; avoid treating manual installs as managed.
- Record versions, reviewed owner, security implications, and reason for inclusion before promoting optional tools to globally active.
