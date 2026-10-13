#!/usr/bin/env bash
set -euo pipefail
if [[ -s "$RUNNER_TEMP/mise-lockfiles" ]]; then
  mise install --locked node pnpm
  printf '%s/bin\n' "$(mise where node)" >> "$GITHUB_PATH"
  printf '%s\n' "$(mise where pnpm)" >> "$GITHUB_PATH"
fi
