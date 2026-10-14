# Owned skills (opt-in)

This directory is not a runtime skill source by itself. `tauri-security-review/SKILL.md` is an example of a **custom skill you own**. To activate it only for a Tauri app:

```bash
mkdir -p /path/to/app/.opencode/skills/tauri-security-review
cp skills/tauri-security-review/SKILL.md /path/to/app/.opencode/skills/tauri-security-review/SKILL.md
```

OpenCode V2 discovers `.opencode/skills/` in the session workspace and its ancestors. Do not globally install every optional skill. Slim's bundled skills stay managed by Slim.
