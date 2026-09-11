# Dev Bootstrap Commands Design

## Scope

Implement the configuration and bootstrap commands requested in issue #3:

- `dev root get`
- `dev root set <path>`
- `dev paths`
- `dev wsl list`
- `dev wsl default get`
- `dev wsl default set <name>`

The change excludes `doctor`, VHDX management, backups, and WSL distro lifecycle operations.

## Architecture

`dev-config` remains the single owner of the configuration file and standard
workspace paths. It gains narrowly scoped persistence APIs for the configured
root and explicit default WSL distro. It validates a root as absolute before
persisting it; its callers create the standard directory layout only after a
successful update.

`dev` owns Clap command parsing, human-readable and JSON rendering, and process
execution. The WSL query is isolated behind a small interface so command
behavior is tested with fixed output rather than a real WSL installation.

## Data Flow

`root get` and `paths` load `dev-config` and render the resolved paths. `root
set` validates and persists the requested root, then creates `disks`,
`wsl\\distros`, `wsl\\backups`, and `tmp` beneath it.

`wsl list` invokes `wsl.exe --list --verbose` with structured arguments and
parses distro name plus version. `wsl default set` reads that same result,
requires an exact matching WSL2 distro, then persists only that name. Neither
path queries or adopts the Windows default distro.

## Errors and Output

Invalid or non-absolute roots, unreadable or invalid configuration, failed WSL
execution, malformed WSL output, unknown distros, and non-WSL2 selections fail
with a non-zero exit status. When `--json` is requested, stdout contains only a
single JSON value; diagnostics remain on stderr.

## Testing

Configuration tests cover default resolution, persistence, absolute-root
validation, and the standard directory layout. CLI tests cover each command's
visible output and JSON shape. WSL parsing and default-distro validation use
fixture output and an injected command runner; no automated test invokes a real
WSL mutation.
