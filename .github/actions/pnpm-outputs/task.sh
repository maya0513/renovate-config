#!/usr/bin/env bash
set -euo pipefail
lockfiles="$RUNNER_TEMP/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"
root=$(git rev-parse --show-toplevel)
source "$ACTION_PATH/../lib/mise.sh"
source "$ACTION_PATH/../lib/snapshot.sh"

if [[ -s "$lockfiles" || "$HAS_VITEPLUS" == true ]]; then
  if [[ -n "$POST_UPDATE_TASK" ]]; then
    snapshot_dependencies > "$RUNNER_TEMP/dependencies-before-task"
    mise install --locked
    MISE_SAFE=0 mise run -- "$POST_UPDATE_TASK"
    if ! snapshot_dependencies > "$RUNNER_TEMP/dependencies-after-task" ||
       ! cmp -s "$RUNNER_TEMP/dependencies-before-task" "$RUNNER_TEMP/dependencies-after-task"; then
      echo '::error::Post-update task changed dependency declarations, lockfiles, or sidecars; generate additional outputs only'
      exit 1
    fi
  fi
fi
