#!/usr/bin/env bash
set -euo pipefail
[[ "$VERIFY_ONLY" == true || "$VERIFY_ONLY" == false ]] || { echo "::error::verify-only must be true or false"; exit 1; }
echo "base=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
lockfiles="$RUNNER_TEMP/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"
: > "$lockfiles"
git ls-files -z -- 'mise.lock' 'mise.*.lock' '**/mise.lock' '**/mise.*.lock' > "$lockfiles"
cp "$lockfiles" "$artifacts"
root=$(git rev-parse --show-toplevel)
while IFS= read -r -d '' lock; do
  if [[ ! -f "$lock" || -L "$lock" || "$(realpath "$lock")" != "$root/"* ]]; then
    echo "::error::Tracked lockfiles must be regular files inside the repository: $lock"
    exit 1
  fi
done < "$lockfiles"

source "$ACTION_PATH/../lib/mise.sh"
printf '%s' "$LOCK_GROUPS" > "$RUNNER_TEMP/lock-groups.json"
jq -e '
  def strings: type == "array" and length > 0 and all(.[]; type == "string" and length > 0);
  type == "array" and all(.[];
    type == "object" and (keys | sort) == ["lockfile", "platforms", "tools", "verify"] and
    (.lockfile | type == "string" and test("^(?!/|\\.git(?:/|$))[^\\u0000\\r\\n]+$") and
      (split("/") | all(.[]; . != "" and . != "." and . != ".."))) and
    (.tools | strings and all(.[]; test("^[A-Za-z0-9][A-Za-z0-9_./:@+-]*$"))) and
    (.platforms | strings and all(.[]; test("^[a-z0-9]+(-[a-z0-9]+)+$"))) and
    (.verify == "regenerate" or .verify == "locked"))
' "$RUNNER_TEMP/lock-groups.json" > /dev/null || {
  echo '::error::Invalid lock-groups; expected lockfile, tools, platforms, verify (regenerate or locked)'
  exit 1
}
group_count=$(jq length "$RUNNER_TEMP/lock-groups.json")

# Explicit groups must cover each selected config exactly once. Never silently
# fall back to an all-platform resolution for a forgotten tool or lockfile.
if [[ "$group_count" != 0 ]]; then
  jq -j '.[] | .lockfile + "\u0000"' "$RUNNER_TEMP/lock-groups.json" > "$RUNNER_TEMP/group-lockfiles"
  while IFS= read -r -d '' lock; do
    if ! git ls-files --error-unmatch -- "$lock" > /dev/null 2>&1 ||
       ! tr '\0' '\n' < "$lockfiles" | grep -Fxq -- "$lock"; then
      echo "::error::lock-groups names an untracked or unselected lockfile: $lock"
      exit 1
    fi
  done < "$RUNNER_TEMP/group-lockfiles"
  while IFS= read -r -d '' lock; do
    mise_for_lock "$lock" config ls --json > "$RUNNER_TEMP/mise-configs.json"
    directory=$(realpath "$(dirname "$lock")")
    suffix=${lock##*/}; suffix=${suffix#mise}; suffix=${suffix%.lock}
    jq -e --arg dir "$directory" --arg suffix "$suffix" --arg lock "$lock" \
      --slurpfile groups "$RUNNER_TEMP/lock-groups.json" '
      [ .[] | select(
          ((.path | sub("/[^/]+$"; "")) == $dir or (.path | sub("/[^/]+$"; "")) == ($dir + "/conf.d")) and
          ((.path | split("/") | last) as $name |
            ["mise" + $suffix + ".toml", ".mise" + $suffix + ".toml", "config" + $suffix + ".toml"] | index($name)))
        | .tools[] ] | unique as $expected |
      [$groups[0][] | select(.lockfile == $lock) | .tools[]] as $actual |
      ($expected | length) > 0 and ($actual | length) == ($actual | unique | length) and
      ($actual | sort) == ($expected | sort)
    ' "$RUNNER_TEMP/mise-configs.json" > /dev/null || {
      echo "::error::lock-groups must cover every configured tool once for $lock"
      exit 1
    }
  done < "$lockfiles"
fi

while IFS= read -r -d '' lock; do
  collect_sidecars "$lock"
  if [[ "$group_count" == 0 ]]; then
    mise_for_lock "$lock" lock
  else
    jq -c --arg lock "$lock" '.[] | select(.lockfile == $lock)' "$RUNNER_TEMP/lock-groups.json" > "$RUNNER_TEMP/current-groups"
    while IFS= read -r group; do
      mapfile -t tools < <(jq -r '.tools[]' <<< "$group")
      platforms=$(jq -r '.platforms | join(",")' <<< "$group")
      if [[ "$VERIFY_ONLY" == true && "$(jq -r .verify <<< "$group")" == locked ]]; then
        # Install the recorded graph on this runner; do not query a fresh solve.
        # Other OS/CPU combinations belong in the caller's CI matrix.
        mise_for_lock "$lock" install --locked "${tools[@]}"
      else
        mise_for_lock "$lock" lock --platform "$platforms" "${tools[@]}"
      fi
    done < "$RUNNER_TEMP/current-groups"
  fi
done < "$lockfiles"
printf "state=%s\nartifact-paths=%s\n" "$RUNNER_TEMP/mise-pnpm-state.json" "$artifacts" >> "$GITHUB_OUTPUT"
jq -n --arg base "$(git rev-parse HEAD)" --arg root "$root" --arg verify "$VERIFY_ONLY" '{base: $base, root: $root, verifyOnly: $verify}' > "$RUNNER_TEMP/mise-pnpm-state.json"
