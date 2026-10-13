#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != --verify ]]; then mise install --locked node pnpm; fi
mise ls --current --json node > "$RUNNER_TEMP/node-tools.json"
mise ls --current --json pnpm > "$RUNNER_TEMP/pnpm-tools.json"
node_home=$(mise where node)
pnpm_home=$(mise where pnpm)
if [[ "${1:-}" != --verify ]]; then export PATH="$node_home/bin:$pnpm_home:$PATH"; fi
export PNPM_EXECUTABLE
PNPM_EXECUTABLE=$(command -v pnpm)
node "$ACTION_PATH/../mise-pnpm/check-tools.mjs"
if [[ "${1:-}" != --verify ]]; then
  printf '%s/bin\n%s\n' "$node_home" "$pnpm_home" >> "$GITHUB_PATH"
fi
