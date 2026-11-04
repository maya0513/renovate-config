# renovate-config

[日本語](README.ja.md)

Use this preset to configure Renovate in another GitHub repository. For personal use

Install the [Mend Renovate App](https://github.com/apps/renovate) and select the target repository. Add `renovate.json` to its default branch, or add the preset reference to an existing configuration's `extends`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["local>maya0513/renovate-config"]
}
```

Enable **Allow auto-merge** under **Settings → General → Pull Requests** in the target repository.

Run CI on Renovate PRs and their subsequent commits, and require all necessary CI checks in the default branch protection rules. Enable **Require branches to be up to date before merging** so updates are tested against the latest default branch before automerge. [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)

For [security fix PRs](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts), enable GitHub's Dependency graph and Dependabot alerts in the target repository.

The preset follows this repository's `main` branch. No npm installation or release tag is required. [Preset reference syntax](https://docs.renovatebot.com/config-presets/#self-hosted-git-current-git-server)

See the [configuration comparison](docs/comparison.md) for update policies.

pnpm consumers must configure at least seven days of release-age protection and
require CI using [`pnpm-outputs`](.github/actions/pnpm-outputs/action.yml), which
checks both the policy and frozen installation. Existing callers need no extra step.
Urgent security fixes use reviewed, version-specific exceptions. See the
[configuration, CI and migration instructions](docs/release-age.md); extending the
Renovate preset alone does not enforce this policy in pnpm.
After adopting protection, consumers explicitly exempt maintenance's Renovate age
check in their own `renovate.json`; the shared default does not grant that exemption.

The shared default includes npm `rangeStrategy: update-lockfile`. Runner changes and this repository's actions and reusable workflows require manual review and shared references update together.

| Configuration | Additional preset | Components composed by the consumer |
| --- | --- | --- |
| pnpm without mise/Vite+ generation | None | Prepare Node/pnpm → `pnpm-outputs` without inputs (verification only) |
| mise-managed Node and pnpm | [`presets/mise-pnpm.json`](presets/mise-pnpm.json) | `mise-pnpm` → `pnpm-outputs` |
| Above + pnpm-managed Vite+ | Above + [`presets/viteplus.json`](presets/viteplus.json) | `mise-pnpm` → `pnpm-viteplus` → `pnpm-outputs` |
| Consumer-prepared Node/pnpm + pnpm-managed Vite+ | [`presets/viteplus.json`](presets/viteplus.json) | Prepare Node/pnpm → `pnpm-viteplus` → `pnpm-outputs` |

The Vite+ component does not require mise. Consumers can provision Node/pnpm through Nix or another method, but the complete flow has not been verified in a Nix environment. The optional `post-update-task` input runs mise tasks only.

Preparation and verification use composite actions. When using generation, prepare tracked lockfiles and both update and verification callers; updates publish the validated result through `publish-pnpm-artifacts.yml` in a separate job. Presets do not invoke these components. Renovate retains native npm artifact generation for pnpm updates.

Input-free pnpm verification needs only an ordinary CI call, with no update caller
or publishing workflow. Projects that do not use pnpm need none of these pnpm components.

For local development, run `mise install --locked`, then `mise run check` to validate configuration, TypeScript, regression tests, workflows and internal actions.
