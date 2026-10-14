# WSL setup

Use [README Get started](../README.md#get-started) for manual setup. There are **no installation or validation scripts** in this repository.

From the `opencode-for-me` checkout, back up `~/.config/opencode/` and copy the contents of `config/opencode/` as shown in the README. If you maintain dotfile symlinks, link individual files to their resolved paths and verify their targets before replacing existing files.

## Separate toolchains

WSL and Windows Desktop do not share runtime PATH or automatically use the same `snip` installation. If OpenCode actually runs in WSL and you use mise:

```bash
mise use -g github:edouard-claude/snip@latest
mise exec -- snip --version
```

Ensure non-interactive OpenCode service processes can resolve the `snip` executable. When appropriate, use mise shims or activate mise in the same shell invocation.

## Symlinks and reloads

Edits to symlink targets may not trigger OpenCode's file watcher. Run `opencode reload` only if supported by the installed version; otherwise restart the relevant service/session after pending work completes. Reading a symlink's latest content with `cat` does not prove the agent loaded it.

## Shared localhost port

Windows Desktop and WSL may both attempt to bind or contact a managed OpenCode service. Check the actual owner before modifying a port or terminating a process:

```bash
ss -ltnp
```

For Windows-side process inspection, see [troubleshooting](troubleshooting.md). Use the CLI appropriate to the service you actually intend to reach.
