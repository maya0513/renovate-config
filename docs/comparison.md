# Configuration comparison

[日本語](comparison.ja.md)

Snapshot: 2026-10-13, Renovate 44.145.1. Includes inherited defaults; excludes consumer and bot-host overrides.
Sources: this repository's [`default.json`](../default.json) and [jdx at `d574ac27`](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/default.json).

## Shared preset

The official [`config:best-practices`](https://docs.renovatebot.com/presets-config/#configbest-practices), jdx and this repository each add policies to [`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended). Renovate [recommends `config:best-practices`](https://docs.renovatebot.com/upgrade-best-practices/#use-the-configbest-practices-preset).

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
| Routine update groups | Curated package and monorepo groups | Same as `config:recommended` | npm, mise, GitHub Actions, Cargo, Go, Docker; others together; named jdx crates separately | `config:recommended` plus one group for this repository's action/workflow references |
| `pin` updates | Standard grouping | Standard grouping | Not included in ecosystem grouping rules | Standard grouping |
| Non-major automerge | Disabled | Disabled | Enabled | Enabled |
| `0.x` minor automerge | Disabled | Disabled | Enabled | Enabled |
| Major updates | Separate; manual merge | Separate; manual merge | Separate; automerge inherited from global `automerge: true` | Separate; manual merge, including security fixes |
| [Platform automerge](https://docs.renovatebot.com/configuration-options/#platformautomerge) | `true`, inactive until automerge is enabled | Same as `config:recommended` | `true` inherited | `true`; GitHub performs the merge |
| [CI checks](https://docs.renovatebot.com/configuration-options/#ignoretests) | `ignoreTests: false` | `ignoreTests: false` | Inherited `false`; platform protections govern native automerge | Inherited `false`; required GitHub checks govern native automerge |
| [Artifact status](https://docs.renovatebot.com/configuration-options/#statuscheckwhen) | `artifactError: "failed"` | Same | Same | Same; report failures only |
| [Rebase policy](https://docs.renovatebot.com/configuration-options/#rebasewhen) | `auto` | `auto` | `conflicted` | `auto` |
| [GitHub Actions SHA pinning](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests) | Not enforced | Enabled | Enabled except `taiki-e/install-action` | Enabled |
| [Docker digest pinning](https://docs.renovatebot.com/presets-docker/#dockerpindigests) | Not enforced | Enabled | Enabled | Enabled |
| Config migration PRs | Disabled | Enabled | Enabled | Enabled |
| [Abandonment rules](https://docs.renovatebot.com/presets-abandonments/#abandonmentsrecommended) | No abandonment preset | `abandonments:recommended` | `abandonments:recommended` | `abandonments:recommended` |
| [Lockfile maintenance](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance) | Disabled | Before 04:00 Monday UTC; manual merge | Before 04:00 Monday Chicago time; `7 days`; automerge | Tuesday JST; automerge |
| [Vulnerability fixes](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts) | No schedule or release-age delay; manual merge | Same as `config:recommended` | Same bypass; global automerge also covers major | Same bypass; non-major automerge, major manual |
| Package-specific exceptions | Community preset rules | Community rules + npm age exemptions below | Named jdx crates bypass both delay and schedule; named jdx tools bypass delay | Runner changes and this repository's reusable workflow revisions require review; workflow revisions bypass the age delay |
| Go-specific overrides | None added | None added | Disable updates to the `go` directive; enable `gomodTidy` | None added |
| npm range strategy | Manager default (`auto`) | `pin` for development dependencies; otherwise manager default | Manager default (`auto`) | `update-lockfile` |
| Ignored supplemental commit author | None added | None added | `github-actions[bot]` email | `github-actions[bot]` email |

Notes on the comparison:

- **Automerge**: values describe eligibility. On GitHub, also enable Allow auto-merge, require necessary CI checks and Require branches to be up to date before merging. `rebaseWhen: auto` alone does not enforce the last condition. [Details](https://docs.renovatebot.com/configuration-options/#platformautomerge)
- **Schedules and delays**: schedules limit new routine updates; existing branch updates and automerges may occur outside the window. Release age also includes the inherited timestamp requirement and buffer. [Scheduling](https://docs.renovatebot.com/configuration-options/#updatenotscheduled), [release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/)
- **Best-practices exceptions**: npm age rules exempt maintenance, replacements, pins and update types without timestamps. Development pinning matches `devDependencies`, `dev-dependencies` and `dev`. [Age rules](https://docs.renovatebot.com/presets-security/#securityminimumreleaseagenpm), [pinning rules](https://docs.renovatebot.com/presets-default/#pindevdependencies)
- **Custom preset automerge**: both jdx and this repository include `0.x`, unlike Renovate's [optional example](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates). jdx major eligibility is inferred from global `automerge: true` and no disabling major rule at the captured revision.
- **`update-lockfile`**: in-range updates keep declarations; out-of-range updates change the range. [Details](https://docs.renovatebot.com/configuration-options/#rangestrategy)

## Companion automation

These components are installed separately from the presets. Sources: [jdx at the same revision](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/.github/workflows/mise-lock.yml), this repository's [preparation actions](../.github/actions) and [publishing workflow](../.github/workflows/publish-pnpm-artifacts.yml).

| Capability | Official Renovate presets | jdx | This repository |
| --- | --- | --- | --- |
| Interface | No companion workflow | `mise-lock.yml` | Consumer composes mise, Vite+ and final-validation actions; a separate workflow publishes |
| mise | — | Generate locks | Generate locks and sidecars; `lock-groups` selects tools, platforms and verification |
| Vite+ | — | — | Align coverage declarations, overrides and lockfile with bundled Vitest and Vite core |
| Additional generation | — | Task and output paths | `post-update-task`, `post-update-paths`; dependency inputs must remain unchanged |
| Verification | — | No dedicated mode | Verification by default, inherited through state; mise differences or locked validation, frozen pnpm and Vite+ graph validation |
| App credentials | — | Optional; falls back to `GITHUB_TOKEN` | Publishing job only; never passed to dependency preparation or verification |
| Update events | — | Check Mend sender ID | Only update callers set the initial component to `false`; preparation and publishing check Mend, push and `renovate/` |
| Publication | — | mise follow-up commit | One commit and push after final validation; match manifest to explicit authorization, enforce allowlist and original-SHA lease |
