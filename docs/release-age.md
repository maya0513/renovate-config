# Release-age policy for pnpm consumers

[日本語](release-age.ja.md)

Ordinary dependencies wait at least seven days after publication. Renovate selects
updates with `minimumReleaseAge: "7 days"`; pnpm applies its own policy when
resolving direct and transitive dependencies. A Renovate preset alone does not
configure pnpm or validate the consumer's configuration.

## Required configuration and CI

Use stable pnpm 12.10.1 or newer, the minimum version verified for this contract.
Track a root `pnpm-workspace.yaml` containing:

```yaml
minimumReleaseAge: 10080 # minutes: seven days
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
```

Longer delays are accepted. Explicitly configured ages default to strict mode in
supported pnpm versions, so omitting `minimumReleaseAgeStrict` is also accepted.
Missing publication timestamps must cause a failure. Keep `trustLockfile` false
(the native default) so frozen installation retains pnpm's lockfile policy checks.
See [pnpm's settings](https://pnpm.io/settings/dependency-resolution#minimumreleaseage).

The existing `pnpm-outputs` action checks this policy before additional generation
and final frozen installation. Existing consumers keep the same calls and required
jobs; upgrade the reviewed shared revision and add the pnpm settings above.

For an ordinary pnpm project without mise/Vite+ generation, prepare the project's
Node/pnpm executables and invoke `pnpm-outputs` without inputs:

```yaml
- name: Verify pnpm dependencies
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
```

Replace `<SHA>` with a reviewed 40-character commit SHA. Use the same revision as
other components from this repository. Require the containing ordinary PR/push CI
job in branch protection; the composite action does not create a separately named
status check. Without preparation state, the action performs policy verification
and frozen installation only, even on a Mend push: it never generates, resets the
index, stages or publishes outputs. No mise or App credentials are needed. When
generating mise/Vite+ outputs, pass their state as before and keep `pnpm-outputs`
in both update and verification callers. Generation inputs require preparation state.
If a preparation component ran for the same checkout and commit, omitting its
state is an error. Standalone verification never creates or clears another
preparation's inventories. Keep one checkout's preparation chain in one job;
verify independent pnpm roots inside the checkout in separate jobs.

Frozen installation disables scripts for verification. Applications that need
dependency build scripts must retain their build/test environment setup too.

The policy step reads effective configuration through `pnpm config list --json`, with
pnpmfile execution disabled and package-manager switching refused. Environment
overrides that lower the age, disable strict mode, permit missing timestamps or
trust the lockfile fail too. The policy step does not install dependencies, change
files or print configuration containing credentials; `pnpm-outputs` then performs
the frozen installation with scripts and pnpmfile execution disabled.
Other commands must retain the same policy/environment; do not override it
with weaker CLI flags. The check is not a sandbox against code that deliberately
changes later CI steps. pnpm itself verifies the resolved graph during installation.
Git/URL dependencies, local/workspace dependencies and pnpm's integrity-pinned
configuration dependencies are outside the registry-release-age guarantee.

## Urgent security fixes

Renovate security alerts bypass its schedule and age delay, but do not automatically
override pnpm's independent policy. A newly published fix can therefore produce an
artifact-generation failure until its exception has been reviewed and committed.

1. Review the advisory and the required fixed version. If a sufficiently old fixed
   version exists, use it without an exception.
2. For an urgent newer fix, add one exact `package@version` entry with a comment
   linking the advisory/reason in the consumer's `pnpm-workspace.yaml`:

   ```yaml
   minimumReleaseAgeExclude:
     # Urgent fix: link to the reviewed advisory here.
     - 'example-lib@1.2.3'
   ```

3. To let the bot generate artifacts, merge the reviewed exception into the base
   branch in a separate PR first, then request rebase/retry on the Renovate PR.
   To finish the same PR manually, update the exception, lockfile and derived
   declarations/outputs yourself and finish the PR without requesting bot regeneration.
4. Require policy, frozen installation and the consumer's tests on the final SHA.
   Remove the exception after the version has passed the consumer's full delay.

Human commits stop ordinary bot updates. Forced regeneration reconstructs the
update from the base branch and can discard exceptions that exist only on the PR
branch. Human pushes also do not run the shared update workflow. Do not add just
an exception to a Renovate branch and then ask the bot to regenerate it.
[Renovate's update/rebase behavior](https://docs.renovatebot.com/updating-rebasing/)

Scoped packages and exact prereleases are accepted. Package-wide exclusions,
wildcards and version ranges are rejected so future versions are not exempted.
An exception applies only to the named version, not to its transitive dependencies;
review any additional required exception individually. Never disable the entire
delay for a security PR. A label or branch name does not approve an exception.
CI validates the scope of an exception; reviewers validate its reason.
See [pnpm's version-specific exclusions](https://pnpm.io/settings/dependency-resolution#minimumreleaseageexclude).

## Lockfile maintenance and Vite+

The shared default does not exempt lockfile maintenance from Renovate's age check.
The preset following `main` and SHA-pinned actions update independently; a global
exemption could reach consumers before their replacement protection. npm/Yarn
maintenance is not automatically exempted either.

After preparing pnpm settings and required CI with the new `pnpm-outputs`, consumers
can explicitly include this in their migration PR's `renovate.json`, retaining
their existing `extends` and other settings:

```json
{
  "npm": {
    "lockFileMaintenance": {
      "minimumReleaseAge": null
    }
  }
}
```

This delegates npm-manager maintenance only to the package manager's validation.
That manager also handles npm/Yarn; in mixed repositories, verify protection for
all affected projects or limit a `packageRules` exemption to protected files with
`matchFileNames`. Other managers and ordinary updates retain seven days of waiting.
Renovate cannot date every locked package, so non-exempt maintenance can otherwise
leave `renovate/stability-days` pending indefinitely.
[Renovate's explanation](https://docs.renovatebot.com/key-concepts/minimum-release-age/#lockfilemaintenance-updates)

pnpm maintenance and ordinary updates use the same age settings and reviewed
exceptions. Tuesday is the update schedule, not the age threshold. Closing an
immortal maintenance PR is not a way to wait; it can be recreated. Seven elapsed
days alone do not fix a status caused by a missing timestamp.

Vite+ may pin newer Vitest, coverage or Vite-core versions even when Vite+ itself is
old enough. In that case, keep the selected versions aligned and wait, or review
specific urgent security exceptions. The shared generation components never add
exclusions or weaken the policy to force a compatible graph.

## Migrating existing consumers

In each consumer's migration PR, prepare the settings, reviewed exceptions if needed,
reviewed `pnpm-outputs` revision and required CI. Verify the final SHA before merging
the migration, including the maintenance exemption above. Existing callers need no
additional action, job or state input. Validate each pnpm project/workspace root
separately; this action checks the current root, not every nested project.
Consumers on old action revisions must finish configuration/CI/reference migration
before adding the exemption. Shared default updates alone do not remove their age checks.

If an old lockfile contains immature dependencies, intentionally regenerate a
compliant graph in the migration PR or wait until they mature. Do not repair it
during ordinary CI. Keep the package-manager version and generated metadata aligned.
This repository checks its own configuration through `mise run policy` before the
`bootstrap` task and uses `pnpm-outputs` in both CI and update preparation. Its own
exemption is selected in [`renovate.json`](../renovate.json). Migration
and real CI evidence in other repositories remain consumer work for
[Issue #24](https://github.com/maya0513/renovate-config/issues/24).
