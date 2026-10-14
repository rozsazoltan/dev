# WSL setup

WSL is a different user environment from Windows Desktop. A Linux `snip` binary or WSL `mise` installation **does not guarantee** that a Windows Desktop plugin can execute `snip`.

```bash
# Repository root:
bash scripts/install-wsl.sh               # preview
bash scripts/install-wsl.sh --apply       # copy only missing files
bash scripts/install-wsl.sh --apply --replace  # backup + replace existing

python3 scripts/validate.py
```

If symlinking your dotfiles, use resolved absolute paths, e.g. `ln -s /path/to/opencode-for-me/config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md`; ensure the parent directory exists and the destination isn't a real file. Scripts intentionally **copy** rather than creating symlinks to minimize surprises.

Install Snip into Linux separately if actually running OpenCode's backend in WSL:

```bash
mise use -g github:edouard-claude/snip@latest
mise exec -- snip --version
mise upgrade github:edouard-claude/snip
```

Ensure the WSL OpenCode **service** environment includes `mise` shims or initializes mise, especially for non-interactive tool invocations. Confirm `command -v snip` from the same process context.

**Symlink hot reload:** a symlink target changing does not guarantee OpenCode's file watcher sees it. Use `opencode reload` if supported by your installed build; otherwise restart the relevant OpenCode service/session after backing up work. Do not assume a rule file was reloaded merely because `cat` shows its updated content.

**Misleading port collision:** if Windows Desktop already listens on 127.0.0.1:49374, a second WSL service may report "managed service port in use". Inspect with `ss -ltnp` in WSL and `Get-NetTCPConnection` on Windows; prefer connecting to the correct existing backend, not killing unknown processes.
