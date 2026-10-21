# Troubleshooting

## User-scope install fails with `Cannot translate ... to a lockfile path`

### Symptom

`apm install <preset> -g --target opencode` resolves every package, then aborts:

```
[x] 5 packages failed:
  +- blader/humanizer -- Failed to integrate primitives from cached package:
     Cannot translate PosixPath('/root/.config/opencode/skills/humanizer')
     to a lockfile path: path is outside the project tree and no dynamic-root
     target matched. This is a bug -- please report it.
```

Nothing is deployed and `~/.apm/apm.yml` is removed again.

### Cause

APM records every deployed file in the lockfile. To do that it turns the deployed path into a path relative to the project root. That translation succeeds in two cases only:

1. the deployed path resolves **inside** the project tree, or
2. a target with a dynamic root owns the path.

A symlink at `~/.config/opencode/skills` that points outside the home directory breaks both. The resolved target is somewhere else on disk, so it is neither inside the tree nor owned by a dynamic-root target. APM then raises this error.

The message prints the **unresolved** path, so it names `/root/.config/opencode/skills/...` even when the real directory lives elsewhere. That is why the path in the error looks correct.

### Not a version regression

Reproduced on both 0.33.0 and 0.34.0 on Linux with an escaping symlink; both fail identically. Windows works because there `%USERPROFILE%\.config\opencode\skills` is a real directory inside the user profile, so case 1 always holds.

### Confirm on the failing machine

```bash
ls -ld ~/.config ~/.config/opencode ~/.config/opencode/skills
readlink -f ~/.config/opencode/skills
printf 'XDG_CONFIG_HOME=%s\nHOME=%s\n' "${XDG_CONFIG_HOME:-}" "$HOME"
pwd
```

A `readlink -f` result outside `$HOME` confirms the diagnosis. A set `XDG_CONFIG_HOME` that points outside `$HOME` has the same effect.

### Fix

Pick one:

- Replace the symlink with a real directory inside `$HOME`, keeping the existing files:
  ```bash
  target="$(readlink -f ~/.config/opencode/skills)"
  rm ~/.config/opencode/skills
  mkdir -p ~/.config/opencode/skills
  cp -a "$target/." ~/.config/opencode/skills/
  ```
- Keep the real directory inside `$HOME` and symlink the other direction, from the external location to the home directory.
- As an immediate workaround, install per project instead of per user, from the project root:
  ```bash
  apm install rozsazoltan/dev/presets/global --target opencode
  ```

### Related: WSL-specific skills path

[`config/opencode-wsl.jsonc`](../config/opencode-wsl.jsonc) pins OpenCode's skills directory to `/mnt/c/Users/dev/.config/opencode/skills`, which exists only inside WSL. Copying that file onto a native Linux host gives OpenCode a skills path that does not exist there. Keep a Linux-specific `opencode.jsonc` instead of reusing the WSL one.
