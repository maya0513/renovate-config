#!/usr/bin/env bash
set -euo pipefail
[[ "$VERIFY_ONLY" == true || "$VERIFY_ONLY" == false ]] || { echo "::error::verify-only must be true or false"; exit 1; }
base=$(git rev-parse HEAD)
root=$(git rev-parse --show-toplevel)
if [[ -z "$MISE_STATE" && -z "$VITEPLUS_STATE" ]]; then
  echo '::error::Select at least one preparation component'; exit 1
fi
check_state() {
  [[ "$1" == "$RUNNER_TEMP/$2" && -f "$1" && ! -L "$1" ]] || {
    echo '::error::Invalid or missing preparation state'; exit 1;
  }
  jq -e --arg base "$base" --arg root "$root" --arg verify "$VERIFY_ONLY" '.base == $base and .root == $root and .verifyOnly == $verify' "$1" > /dev/null || {
    echo '::error::Preparation components must use the same commit, repository and verify-only mode'; exit 1;
  }
}
[[ -z "$MISE_STATE" ]] || check_state "$MISE_STATE" mise-pnpm-state.json
[[ -z "$VITEPLUS_STATE" ]] || check_state "$VITEPLUS_STATE" viteplus-state.json
# An absent component contributes no mise artifacts, even on a reused runner.
if [[ -z "$MISE_STATE" ]]; then
  : > "$RUNNER_TEMP/mise-lockfiles"
  : > "$RUNNER_TEMP/mise-lock-artifacts"
fi
printf 'HAS_VITEPLUS=%s\n' "$([[ -n "$VITEPLUS_STATE" ]] && echo true || echo false)" >> "$GITHUB_ENV"
printf 'PREPARATION_BASE=%s\n' "$base" >> "$GITHUB_ENV"
