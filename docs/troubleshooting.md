# Troubleshooting

## User-scope install on Linux

If `apm install ... -g --target opencode` aborts with `Cannot translate ... to a lockfile path`, the skills directory is not a real directory inside your home directory. APM cannot record a symlinked location that points elsewhere.

Check it:

```bash
readlink -f ~/.config/opencode/skills
```

Make it a real directory, then install:

```bash
target="$(readlink -f ~/.config/opencode/skills)"
rm ~/.config/opencode/skills
mkdir -p ~/.config/opencode/skills
cp -a "$target/." ~/.config/opencode/skills/

apm install rozsazoltan/dev/presets/global -g --target opencode
```

A fresh install needs only the `mkdir -p` line before the command.

Windows is unaffected: `%USERPROFILE%\.config\opencode\skills` is already a real directory.

## WSL skills path

[`config/opencode-wsl.jsonc`](../config/opencode-wsl.jsonc) pins the skills directory to `/mnt/c/Users/dev/.config/opencode/skills`, which exists only under WSL. On a native Linux host, use a Linux-specific `opencode.jsonc` instead.
