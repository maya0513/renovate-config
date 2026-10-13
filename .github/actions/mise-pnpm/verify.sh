#!/usr/bin/env bash
set -euo pipefail
lockfiles="$RUNNER_TEMP/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"
source "$ACTION_PATH/../lib/mise.sh"
while IFS= read -r -d '' lock; do
  mise_for_lock "$lock" install --locked --dry-run
  collect_sidecars "$lock"
done < "$lockfiles"
bash "$ACTION_PATH/../mise-pnpm/tools.sh" --verify
