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

See the [configuration comparison](docs/comparison.md) for update policies and the [Japanese lockfile operations memo](docs/lockfile-operations.ja.md) for reusable workflow setup. Workflows require a separate caller configuration. Vite+ users can additionally select [`presets/vite-plus.json`](presets/vite-plus.json) together with declaration synchronization; it is not included in the default preset.

For local development, run `mise install --locked`, then `mise run check` to validate configuration, TypeScript, regression tests, and workflows.
