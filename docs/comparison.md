# Configuration comparison

[日本語](comparison.ja.md)

Checked on **2026-10-12**. The official columns compare [`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended) and [`config:best-practices`](https://docs.renovatebot.com/presets-config/#configbest-practices), including their inherited defaults. The comparison and this repository's validator both use Renovate **44.145.1**.

This repository's shared settings come from [`default.json`](../default.json). The jdx snapshot is [`d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0`](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/default.json). Repository or bot-host overrides are outside this comparison.

## Shared preset

`config:recommended` and `config:best-practices` are official presets provided by Renovate. The former is a general-purpose baseline; the latter extends it with policies such as development dependency pinning and weekly lockfile updates. The [Renovate upgrade guide](https://docs.renovatebot.com/upgrade-best-practices/#use-the-configbest-practices-preset) recommends `config:best-practices`.

jdx and this repository provide custom presets based on `config:recommended`.

Automerge values describe eligibility; repository permissions and protection rules still apply. Neither official preset enables automerge.

For native automerge on GitHub, enable **Allow auto-merge** and require all necessary CI checks. Enable **Require branches to be up to date before merging** to verify updates against the latest default branch; `rebaseWhen: auto` alone does not enforce that requirement when GitHub performs the merge. [Platform automerge](https://docs.renovatebot.com/configuration-options/#platformautomerge)

| Setting | `config:recommended` | `config:best-practices` | `local>jdx/renovate-config` | `local>maya0513/renovate-config` |
| --- | --- | --- | --- | --- |
| Base | `config:recommended` | `config:recommended` + seven additional presets | `config:recommended` + four additional presets | `config:recommended` + four additional presets |
| [Manager detection](https://docs.renovatebot.com/configuration-options/#enabledmanagers) | Default-enabled managers | Same; no allowlist | Same; Go directive exception below | Same; no allowlist |
| Ignored paths | Dependencies, examples, tests, fixtures | Same as `config:recommended` | `config:recommended` + `**/.mise/locks/**`, `**/.config/mise/locks/**` | Same as `local>jdx/renovate-config` |
| [Schedule / timezone](https://docs.renovatebot.com/configuration-options/#schedule) | Any time / UTC | Any time / UTC | Tuesday / `America/Chicago` | Tuesday / `Asia/Tokyo` |
| [Release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) | No global delay | npm datasource: `3 days`; no global delay | `7 days`; named jdx packages have exceptions | `7 days` |
| [Internal check filtering](https://docs.renovatebot.com/configuration-options/#internalchecksfilter) | `strict` | `strict` | `strict` inherited | `strict` |
| [Dependency Dashboard](https://docs.renovatebot.com/configuration-options/#dependencydashboard) | Enabled | Enabled | Disabled | Disabled |
| [Clone submodules](https://docs.renovatebot.com/configuration-options/#clonesubmodules) | Disabled | Disabled | Enabled | Enabled |
| [PR limits](https://docs.renovatebot.com/configuration-options/#prhourlylimit), hourly / concurrent | 2 / 10 | 2 / 10 | 10 / 10 | 10 / 10 |
| Routine update groups | Curated package and monorepo groups | Same as `config:recommended` | npm, mise, GitHub Actions, Cargo, Go, Docker; others together; named jdx crates separately | Same as `config:recommended` |
| `pin` updates | Standard grouping | Standard grouping | Not included in ecosystem grouping rules | Standard grouping |
| Non-major automerge | Disabled | Disabled | Enabled | Enabled |
| `0.x` minor automerge | Disabled | Disabled | Enabled | Enabled |
| Major updates | Separate; manual merge | Separate; manual merge | Separate; automerge inherited from global `automerge: true` | Separate; manual merge, including security fixes |
| [Platform automerge](https://docs.renovatebot.com/configuration-options/#platformautomerge) | `true`, inactive until automerge is enabled | Same as `config:recommended` | `true` inherited | `true`; GitHub performs the merge |
| [CI checks](https://docs.renovatebot.com/configuration-options/#ignoretests) | `ignoreTests: false` | `ignoreTests: false` | Inherited `false`; platform protections govern native automerge | Explicit `false`; required GitHub checks govern native automerge |
| [Artifact status](https://docs.renovatebot.com/configuration-options/#statuscheckwhen) | `artifactError: "failed"` | Same | Same | `artifactError: "always"`; report success and failure |
| [Rebase policy](https://docs.renovatebot.com/configuration-options/#rebasewhen) | `auto` | `auto` | `conflicted` | `auto` |
| [GitHub Actions SHA pinning](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests) | Not enforced | Enabled | Enabled except `taiki-e/install-action` | Enabled |
| [Docker digest pinning](https://docs.renovatebot.com/presets-docker/#dockerpindigests) | Not enforced | Enabled | Enabled | Enabled |
| Config migration PRs | Disabled | Enabled | Enabled | Enabled |
| [Abandonment rules](https://docs.renovatebot.com/presets-abandonments/#abandonmentsrecommended) | No abandonment preset | `abandonments:recommended` | `abandonments:recommended` | `abandonments:recommended` |
| [Lockfile maintenance](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance) | Disabled | Before 04:00 Monday UTC; manual merge | Before 04:00 Monday Chicago time; `7 days`; automerge | Tuesday JST; automerge |
| [Vulnerability fixes](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts) | No schedule or release-age delay; manual merge | Same as `config:recommended` | Same bypass; global automerge also covers major | Same bypass; non-major automerge, major manual |
| Package-specific exceptions | Community preset rules | Community rules + npm age exemptions below | Named jdx crates bypass both delay and schedule; named jdx tools bypass delay | No owner-specific exceptions |
| Go-specific overrides | None added | None added | Disable updates to the `go` directive; enable `gomodTidy` | None added |
| npm range strategy | Manager default (`auto`) | `pin` for development dependencies; otherwise manager default | Manager default (`auto`) | Manager default (`auto`) in shared preset |
| Ignored supplemental commit author | None added | None added | `github-actions[bot]` email | `github-actions[bot]` email |

The npm release-age rule in `config:best-practices` exempts lockfile maintenance, replacements, pins, and update types without release timestamps. Its development dependency pinning matches `devDependencies`, `dev-dependencies`, and `dev`. [npm age policy](https://docs.renovatebot.com/presets-security/#securityminimumreleaseagenpm), [development dependency pinning](https://docs.renovatebot.com/presets-default/#pindevdependencies)

Schedules limit new routine update creation. Existing branch updates and automerges can occur outside that window. With a release-age threshold, the inherited timestamp requirement and release-age buffer also apply. [Scheduling](https://docs.renovatebot.com/configuration-options/#updatenotscheduled), [release-age behavior](https://docs.renovatebot.com/key-concepts/minimum-release-age/)

The `0.x` row describes actual preset behavior. Renovate's [optional non-major automerge example](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates) excludes pre-1.0 packages; the custom presets from jdx and this repository allow them. jdx's major eligibility is inferred from its global `automerge: true` and absence of a disabling major rule at the captured revision.

## Supplemental workflows

These are separate workflow settings, not part of either official preset. Sources: [jdx workflow at the same revision](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/.github/workflows/mise-lock.yml), [this workflow](../.github/workflows/mise-lock.yml).

| Setting | `config:recommended` | `config:best-practices` | `local>jdx/renovate-config` | `local>maya0513/renovate-config` |
| --- | --- | --- | --- | --- |
| Reusable lockfile workflow | Not provided by the preset | Not provided by the preset | `mise-lock.yml` | `mise-lock.yml` |
| App credentials | Not defined | Not defined | Optional `MISE_LOCK_APP_ID` + `MISE_LOCK_APP_PRIVATE_KEY` secrets; falls back to `GITHUB_TOKEN` | Required `app-client-id` input + `app-private-key` secret for updates; unnecessary for verification |
| Generated artifacts | Not defined | Not defined | `post_update_task`, `post_update_paths` | `post-update-task`, `post-update-paths` |
| Verification mode | Not defined | Not defined | None | `verify-only: true` fails on regeneration differences; no commit or push |
| Own-push prevention | Not defined | Not defined | Mend sender ID; caller filters branches | Updates check Mend sender ID + push event + `renovate/` branch; verification has no event restriction |
| Branch movement | Not defined | Not defined | Lease, then fetch / inspect / retry or rebase when appropriate | Reject moved or deleted branches using an exact lease |
| Vite+ alignment | — | — | — | Align coverage with bundled Vitest |

Only this repository's own [`renovate.json`](../renovate.json) sets npm `rangeStrategy: "update-lockfile"`: in-range updates change the lockfile, and out-of-range updates change the declared range. Consumers do not inherit this repository-only override. [Range strategy](https://docs.renovatebot.com/configuration-options/#rangestrategy)

This repository verifies human, Renovate, and supplemental App changes through the same CI verification mode. Require `check` and `dependency-artifacts / mise-lock`, with branches up to date against main. Do not require `renovate/artifacts` for every PR: ordinary PRs do not emit it.

[`package.json`](../package.json) and [`mise.toml`](../mise.toml) declare matching exact Node and pnpm versions, checked in CI. Repository-only rules group npm and mise updates separately for each tool while keeping major updates manual. Consumers do not inherit these rules. See the [Japanese lockfile operations memo](lockfile-operations.ja.md) for operational guidance.
