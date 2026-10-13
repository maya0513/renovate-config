#!/usr/bin/env bash
artifacts="${RUNNER_TEMP:?}/mise-lock-artifacts"

mise_for_lock() {
  local lock="$1" name="${1##*/}" mise_env="" is_local=false
  shift
  local args=("$@")
  case "$name" in
    mise.lock) ;;
    mise.local.lock) is_local=true ;;
    mise.*.local.lock) mise_env=${name#mise.}; mise_env=${mise_env%.local.lock}; is_local=true ;;
    mise.*.lock) mise_env=${name#mise.}; mise_env=${mise_env%.lock} ;;
  esac
  if [[ "$1" == lock && "$is_local" == true ]]; then args+=(--local); fi
  (cd "$(dirname "$lock")" && MISE_ENV="$mise_env" mise "${args[@]}")
}

collect_sidecars() {
  local lock="$1" path
  mise_for_lock "$lock" lock --sidecars --json > "$RUNNER_TEMP/mise-sidecars.json"
  jq -j --arg lock "${lock##*/}" '.[] | select(.lockfile == $lock) | .sidecars[] | .path + "\u0000"' \
    "$RUNNER_TEMP/mise-sidecars.json" > "$RUNNER_TEMP/mise-sidecars"
  while IFS= read -r -d '' path; do
    if [[ "$path" != /* ]]; then path="$(dirname "$lock")/$path"; fi
    printf '%s\0' "$path" >> "$artifacts"
  done < "$RUNNER_TEMP/mise-sidecars"
}
