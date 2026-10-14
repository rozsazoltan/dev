#!/usr/bin/env bash
set -euo pipefail

apply=false
replace=false
for arg in "$@"; do
  case "$arg" in
    --apply) apply=true ;;
    --replace) replace=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done
if "$replace" && ! "$apply"; then
  echo "--replace requires --apply" >&2; exit 2
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_config="$repo/config/opencode"
config_dir="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
backup_suffix="$(date +%Y%m%d-%H%M%S)"
files=(
  opencode.jsonc
  AGENTS.md
  oh-my-opencode-slim.jsonc
  dcp.jsonc
  prompts/command.md
  oh-my-opencode-slim/codex/orchestrator_append.md
)
copy_safe() {
  local source="$1" target="$2"
  [[ -f "$source" ]] || { echo "Missing source: $source" >&2; exit 1; }
  if [[ -e "$target" || -L "$target" ]] && ! "$replace"; then
    echo "SKIP  exists: $target"; return
  fi
  if ! "$apply"; then
    echo "PLAN  $source -> $target"; return
  fi
  mkdir -p "$(dirname "$target")"
  if [[ -e "$target" || -L "$target" ]]; then
    cp -P "$target" "$target.backup-$backup_suffix"
    echo "BACKUP $target.backup-$backup_suffix"
    # Replace symlinks intentionally with a real file on explicit --replace.
    [[ ! -L "$target" ]] || rm -- "$target"
  fi
  cp -- "$source" "$target"
  echo "COPY  $target"
}
for item in "${files[@]}"; do
  copy_safe "$source_config/$item" "$config_dir/$item"
done
copy_safe "$repo/config/apm/apm.yml" "$HOME/.apm/apm.yml"
"$apply" || echo 'Dry run. Add --apply to copy, optionally --replace for backed-up overwrite.'
