#!/usr/bin/env bash
set -euo pipefail
lockfiles="$RUNNER_TEMP/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"
groups_file="$RUNNER_TEMP/lock-groups.json"
source "$ACTION_PATH/../lib/mise.sh"
while IFS= read -r -d '' lock; do
  if [[ -f "$groups_file" ]] && [[ "$(jq length "$groups_file")" != 0 ]]; then
    # Honor the verification mode preparation recorded for each group.
    # Regenerated groups were already re-locked and compared during
    # preparation; a locked dry-run for them is not only redundant, it
    # cannot succeed for backends that cannot resolve a download from
    # the recorded checksums alone (e.g. Conda under MISE_SAFE=1).
    mapfile -t locked_tools < <(jq -r --arg lock "$lock" \
      '.[] | select(.lockfile == $lock and .verify == "locked") | .tools[]' "$groups_file")
    if [[ "${#locked_tools[@]}" != 0 ]]; then
      mise_for_lock "$lock" install --locked --dry-run "${locked_tools[@]}"
    fi
  else
    mise_for_lock "$lock" install --locked --dry-run
  fi
  collect_sidecars "$lock"
done < "$lockfiles"
bash "$ACTION_PATH/../mise-pnpm/tools.sh" --verify
