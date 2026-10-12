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

See the [configuration comparison](docs/comparison.md) for update policies, the [preset boundaries and consumer migration guide (Japanese)](docs/preset-boundaries.ja.md), and the [Japanese lockfile operations memo](docs/lockfile-operations.ja.md) for reusable workflow setup.

The shared default uses npm `rangeStrategy: update-lockfile`. Runner changes and revisions of this repository's reusable workflows require manual review. Tool configurations are opt-in:

| Configuration | Additional preset | Required workflow |
| --- | --- | --- |
| mise-managed Node and pnpm | [`presets/mise-pnpm.json`](presets/mise-pnpm.json) | Update and verification callers of `dependency-artifacts.yml` |
| Vite+ derived dependencies | [`presets/vite-plus.json`](presets/vite-plus.json) | `vite-plus.yml` or `dependency-artifacts.yml` with declaration synchronization |
| Both | Both presets | One integrated `dependency-artifacts.yml` caller per mode |

Presets do not activate workflows. Before selecting `mise-pnpm`, track the mise lockfile and configure both callers: this preset disables native mise artifacts and artifacts for Node updates. Renovate still generates npm artifacts for pnpm updates.

For local development, run `mise install --locked`, then `mise run check` to validate configuration, TypeScript, regression tests, and workflows.
