# Choosing presets and generation components

[日本語](presets-and-workflows.ja.md)

Renovate selects dependency updates. Consumers compose generation components, validate the complete result, then publish once. Supported configurations are mise-managed Node and pnpm, optionally with pnpm-managed Vite+.

## What to select

| Consumer configuration | Additional presets | Order within one preparation job |
| --- | --- | --- |
| mise-managed Node and pnpm | `mise-pnpm` | `mise-pnpm` → `pnpm-outputs` |
| Above + pnpm-managed Vite+ | `mise-pnpm`, `viteplus` | `mise-pnpm` → `pnpm-viteplus` → `pnpm-outputs` |

Updates call `publish-pnpm-artifacts.yml` in a separate job. Individual preparation components never commit or push.

| Responsibility | Owner |
| --- | --- |
| Update and review policy | Shared default: npm `update-lockfile`; manual review for majors, runners and this repository's actions/workflows |
| Group Node and pnpm declarations | [`mise-pnpm` preset](../presets/mise-pnpm.json): disable mise artifact generation/maintenance and Node artifact generation |
| Disable independent root derived-dependency updates | [`viteplus` preset](../presets/viteplus.json): root coverage, Vitest and Vite core only; nested independent projects remain eligible |
| mise locks, sidecars and executable preparation | [`mise-pnpm` action](../.github/actions/mise-pnpm/action.yml) |
| Vite+ derived dependencies | [`pnpm-viteplus` action](../.github/actions/pnpm-viteplus/action.yml): use Node and pnpm already on PATH; does not prepare mise |
| Additional generation, final validation and payload | [`pnpm-outputs` action](../.github/actions/pnpm-outputs/action.yml) |
| App authentication, commit and push | [`publish-pnpm-artifacts.yml`](../.github/workflows/publish-pnpm-artifacts.yml): never executes dependencies |
| Platforms, compatibility, tasks, required checks and releases | Consumer |

Renovate retains native npm artifact generation for pnpm updates. Companion actions do not repair stale pnpm manager metadata. If the initial frozen install fails, inspect Renovate's artifact generation result and logs first.

## Prerequisites

Run preparation on Linux, such as Ubuntu, with Bash, GNU coreutils, jq, Git and mise. Lock-group target platforms are distinct from the runner performing generation.

1. Generate and track initial mise locks, sidecars and the pnpm lockfile. Declare matching exact Node/pnpm versions in mise and `package.json`; set `pmOnFail: error` in `pnpm-workspace.yaml`.
2. Extend the shared default and configuration-specific presets. Presets do not invoke actions.
3. Prepare checkout (`persist-credentials: false`) and mise-action (`install: false`), then invoke the components in order. Pass identical lock groups, generation task and output paths to update and verification callers.
4. Run CI for both updates and verification. Only Mend Renovate pushes to `renovate/` branches use update mode; follow-up App pushes use verification.

Policy versus runtime enforcement: matching Node/pnpm declarations are a usage requirement. Each install checks the pnpm executable with `--pm-on-fail=error`; consumers must check Node declaration agreement in their CI. Setting `pmOnFail: error` also aligns local commands with this policy. The shared components always supply the CLI flag, so a missing setting alone does not fail them.

Vite+ prerequisites: tracked root `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Declare coverage as a major or an exact stable version. A bundled Vitest major change requires compatibility review. Ambiguous overrides and YAML flow mappings, anchors or aliases fail rather than being rewritten.

## Consumer composition

These are the main preparation steps. Environment names such as `env.VERIFY_ONLY` and step IDs are examples, not fixed names; input values may also be specified directly. Replace every `<SHA>` with the same reviewed 40-character commit SHA. Set `env.VERIFY_ONLY` to `false` for updates and `true` for ordinary CI. Composite action inputs are strings.

```yaml
- id: mise
  uses: maya0513/renovate-config/.github/actions/mise-pnpm@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    lock-groups: ${{ env.LOCK_GROUPS }}
- id: viteplus
  uses: maya0513/renovate-config/.github/actions/pnpm-viteplus@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    prepared-paths: ${{ steps.mise.outputs.artifact-paths }}
- id: outputs
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    mise-state: ${{ steps.mise.outputs.state }}
    viteplus-state: ${{ steps.viteplus.outputs.state }}
    post-update-task: ${{ env.POST_UPDATE_TASK }}
    post-update-paths: ${{ env.POST_UPDATE_PATHS }}
```

Without Vite+, omit its step and `viteplus-state`. Export `base`, `changed` and `artifact-id` from the final step as preparation job outputs. This repository's [verification caller](../.github/workflows/ci.yml) and [update caller](../.github/workflows/update.yml) demonstrate mise + pnpm.

The publishing job uses `needs: prepare` and `uses: maya0513/renovate-config/.github/workflows/publish-pnpm-artifacts.yml@<SHA>`. Do not invoke it in ordinary CI.

| Publishing input | Value |
| --- | --- |
| `base`, `changed`, `artifact-id` | Matching outputs from `needs.prepare.outputs` |
| `mise` | `true` (default): include mise outputs in the publishing allowlist |
| `viteplus` | `true` only when composing Vite+: also allow root declarations and the pnpm lockfile |
| `post-update-paths` | Same value as preparation |
| `app-client-id` | App Client ID |
| Secret `app-private-key` | App private key |

## Inputs and verification

| Component | Input/output | Contract |
| --- | --- | --- |
| All preparation/validation actions | `verify-only` (default `false`) | Accept only `true` or `false`; use the same mode throughout composition |
| mise preparation | `lock-groups` (default `[]`) | Explicit groups must cover every configured tool once for each lockfile |
| mise preparation | Outputs `state`, `artifact-paths` | Pass to later components in the same job; do not edit |
| Vite+ preparation | `prepared-paths` (optional) | Allow already prepared mise artifacts in the otherwise clean checkout |
| Vite+ preparation | Output `state` | Pass to final validation. The component does not require mise itself; supported consumers prepare mise first |
| Final validation | `mise-state`, `viteplus-state` | Pass only outputs of selected components; repository, commit and verification mode must match |
| Final validation | `post-update-task`, `post-update-paths` (default empty) | Run a mise task for additional outputs; add only explicit paths to publication |
| Final validation | Outputs `base`, `changed`, `artifact-id` | Upload only validated update payloads; verification never uploads |

Example lock group:

```json
[{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]
```

- `regenerate`: regenerate selected platforms; reject differences during verification.
- `locked`: generate during updates; verify the recorded graph through locked installation. Other platforms belong in the consumer CI matrix.
- Empty array: retain all-tool regeneration for tracked mise lockfiles.

Additional tasks must not change dependency declarations, effective mise configuration, managed lockfiles or sidecars. Configuration additions and removals also fail. Listing a dependency input in `post-update-paths` does not lift this restriction. Additional outputs may be created, changed or removed. Move dependency-changing work from existing tasks to preparation before the task.

Final validation runs after additional generation: locked mise validation, frozen installation with the same executables/options, then Vite+ declaration and graph validation. Vite+ checks coverage against bundled Vitest, one Vitest instance, the Vite core alias, unchanged selected Vite+ and unchanged unrelated dependency versions. Verification never repairs declarations or pnpm lockfiles.

## Authentication and migration

Recommended names: Variable `DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`, Secret `DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`. Reuse an existing App installation; existing Secrets need not be renamed. Limit App publication to Contents-write for the target repository. Ordinary `GITHUB_TOKEN` access is Contents-read.

The publisher checks out the original SHA and downloads the immutable artifact ID. It validates allowed paths and regular files, commits, then creates the App token and pushes with an original-SHA lease. Moved or deleted branches are never overwritten.

There are no old-name compatibility files. Pin consumers' old preset references to an existing SHA before merging the shared deletion. Then migrate to the new preset name and components at the same reviewed SHA. [Issue #3](https://github.com/maya0513/renovate-config/issues/3) remains incomplete until consumer migration, full CI and latest-SHA CI after App publication have been confirmed.

## Issue #3 verification boundary

| Issue requirement | Repository verification | Remaining evidence |
| --- | --- | --- |
| Shared policy and optional rules | Actual Renovate resolution/extraction: manual majors, root-only derived dependency suppression, retained pnpm artifact generation | Consumer reference migration |
| Current pnpm settings and executables | `pmOnFail: error`, selected executable precedence, actual Node/pnpm executable transitions | Generated output in real Renovate PRs |
| Initial frozen-install failure | Reproduce actual pnpm manager metadata mismatch; native-equivalent lockfile generation enables update and frozen verification | Renovate Bot artifact generation and consumer CI |
| Generated and validated state agree | Accept additional outputs; reject invalid declarations, locks, sidecars, importers and preparation state | Consumer-specific generation and CI matrices |
| Credentials and publication | Check credential isolation, allowlists, immutable artifact ID, moved/deleted branch leases | Latest-SHA CI after a real App push |

Consumer changes are follow-up work. This change alone does not close the issue.
