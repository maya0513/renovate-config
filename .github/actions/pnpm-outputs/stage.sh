#!/usr/bin/env bash
set -euo pipefail
[[ "$(git rev-parse HEAD)" == "$PREPARATION_BASE" ]] || { echo "::error::Generation changed the prepared commit"; exit 1; }
lockfiles="$RUNNER_TEMP/mise-lockfiles"
artifacts="$RUNNER_TEMP/mise-lock-artifacts"
root=$(git rev-parse --show-toplevel)
source "$ACTION_PATH/../lib/mise.sh"
stage_path() {
  local path="$1"
  if [[ "$(realpath -m "$path")" != "$root/"* ]]; then
    echo "::error::Artifact paths must stay inside the repository: $path"
    exit 1
  fi
  if [[ -e "$path" || -L "$path" ]] || [[ -n "$(git --literal-pathspecs ls-files -- "$path")" ]]; then
    git --literal-pathspecs add -A -- "$path"
  fi
}
git reset --quiet
while IFS= read -r -d '' path; do stage_path "$path"; done < "$artifacts"
if [[ "$HAS_VITEPLUS" == true ]]; then
  stage_path pnpm-lock.yaml
  stage_path package.json
  stage_path pnpm-workspace.yaml
fi
if [[ -s "$lockfiles" || "$HAS_VITEPLUS" == true ]]; then
  while IFS= read -r path || [[ -n "$path" ]]; do
    path=${path%$'\r'}
    [[ -n "$path" ]] || continue
    while [[ "$path" == ./* ]]; do path=${path#./}; done
    case "$path" in
      ''|/*|.|..|../*|*/../*|*/..|.git|.git/*)
        echo "::error::Post-update paths must name files or directories inside the repository: $path"
        exit 1 ;;
    esac
    stage_path "$path"
  done <<< "$POST_UPDATE_PATHS"
fi
git diff --cached --check
if git diff --cached --quiet; then
  echo "changed=false" >> "$GITHUB_OUTPUT"
  exit 0
fi
if [[ "$VERIFY_ONLY" == true ]]; then
  git diff --cached --stat
  echo '::error::Dependency artifacts are out of date; regenerate and commit them'
  exit 1
fi
mkdir -p "$RUNNER_TEMP/pnpm-artifacts"
git diff --cached --binary --full-index > "$RUNNER_TEMP/pnpm-artifacts/changes.patch"
echo "changed=true" >> "$GITHUB_OUTPUT"
