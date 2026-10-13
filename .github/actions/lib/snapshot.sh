#!/usr/bin/env bash
root=$(git rev-parse --show-toplevel)
lockfiles="${RUNNER_TEMP:?}/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"

snapshot_dependencies() {
  local lock path entry
  local inventory="$RUNNER_TEMP/dependency-inputs"
  # Retain missing paths too, so removing a declaration or sidecar is
  # distinguishable from a task that never touched dependency inputs.
  printf 'package.json\0pnpm-workspace.yaml\0pnpm-lock.yaml\0' > "$inventory"
  git ls-files -z -- 'package.json' '**/package.json' 'pnpm-workspace.yaml' '**/pnpm-workspace.yaml' \
    'pnpm-lock.yaml' '**/pnpm-lock.yaml' >> "$inventory" || return 1
  mise config ls --json > "$RUNNER_TEMP/task-configs.json" || return 1
  jq -j --arg root "$root/" '.[] | .path | select(startswith($root)) | . + "\u0000"' \
    "$RUNNER_TEMP/task-configs.json" >> "$inventory" || return 1
  while IFS= read -r -d '' lock; do
    collect_sidecars "$lock" || return 1
    mise_for_lock "$lock" config ls --json > "$RUNNER_TEMP/task-configs.json" || return 1
    jq -j --arg root "$root/" '.[] | .path | select(startswith($root)) | . + "\u0000"' \
      "$RUNNER_TEMP/task-configs.json" >> "$inventory" || return 1
  done < "$lockfiles"
  cat "$artifacts" >> "$inventory"
  # Expand only referenced sidecar directories, including untracked
  # files. Do not include unrelated graphs beside those directories.
  while IFS= read -r -d '' path; do
    path=$(realpath -m "$path") || return 1
    [[ "$path" == "$root/"* ]] || return 1
    printf '%s\0' "$path"
    if [[ -d "$path" && ! -L "$path" ]]; then find "$path" -mindepth 1 -print0 || return 1; fi
  done < "$inventory" > "$RUNNER_TEMP/dependency-files"
  sort -zu "$RUNNER_TEMP/dependency-files" > "$RUNNER_TEMP/dependency-files-sorted"
  while IFS= read -r -d '' entry; do
    printf '%s\0' "$entry"
    if [[ -L "$entry" ]]; then
      printf 'symlink\0'; readlink -z -- "$entry" || return 1
    elif [[ -f "$entry" ]]; then
      stat -c '%a' -- "$entry" || return 1
      git hash-object --no-filters -- "$entry" || return 1
    elif [[ -d "$entry" ]]; then printf 'directory\0'
    elif [[ -e "$entry" ]]; then return 1
    else printf 'missing\0'
    fi
  done < "$RUNNER_TEMP/dependency-files-sorted"
}
