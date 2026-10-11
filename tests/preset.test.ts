import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from 'renovate/dist/config/defaults.js';
import { GlobalConfig } from 'renovate/dist/config/global.js';
import { resolveConfigPresets } from 'renovate/dist/config/presets/index.js';
import type { RenovateConfig, UpdateType } from 'renovate/dist/config/types.js';
import { mergeChildConfig } from 'renovate/dist/config/utils.js';
import { init as initLogger } from 'renovate/dist/logger/index.js';
import type { PackageDependency } from 'renovate/dist/modules/manager/types.js';
import type { BranchUpgradeConfig } from 'renovate/dist/workers/types.js';
import { extractPackageFile as extractMise } from 'renovate/dist/modules/manager/mise/extract.js';
import { updateLockedDependency } from 'renovate/dist/modules/manager/mise/update-locked.js';
import { extractPackageFile as extractNpm } from 'renovate/dist/modules/manager/npm/extract/index.js';
import { extractPackageFile as extractActions } from 'renovate/dist/modules/manager/github-actions/extract.js';
import { api as npmVersioning } from 'renovate/dist/modules/versioning/npm/index.js';
import { getNodeToolConstraint } from 'renovate/dist/modules/manager/npm/post-update/node-version.js';
import { getPackageManagerVersion, lazyLoadPackageJson } from 'renovate/dist/modules/manager/npm/post-update/utils.js';
import platformApis from 'renovate/dist/modules/platform/api.js';
import { setPlatformApi } from 'renovate/dist/modules/platform/index.js';
import type { BranchStatusConfig } from 'renovate/dist/modules/platform/types.js';
import { setArtifactErrorStatus } from 'renovate/dist/workers/repository/update/branch/artifacts.js';
import { checkMinimumReleaseAge } from 'renovate/dist/util/minimum-release-age.js';
import { flattenUpdates } from 'renovate/dist/workers/repository/updates/flatten.js';
import { cronMatches, isScheduledNow } from 'renovate/dist/workers/repository/update/branch/schedule.js';
import { resolveLocalConfig } from '../scripts/dry-run.ts';

// Use the same Luxon instance as Renovate when probing its cron implementation.
const requireRenovate = createRequire(realpathSync(new URL('../node_modules/renovate/package.json', import.meta.url)));
const { DateTime } = requireRenovate('luxon') as typeof import('luxon');
await initLogger();
// Renovate may reset localDir during Git recovery. Never point it at source files.
const temporary = mkdtempSync(join(tmpdir(), 'renovate-config-preset-test-'));
const repository = join(temporary, 'repository');
for (const name of ['mise.toml', 'mise.lock', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.github']) {
  cpSync(new URL(`../${name}`, import.meta.url), join(repository, name), { recursive: true });
}
const previousGlobalConfig = GlobalConfig.get();
GlobalConfig.set({ ...previousGlobalConfig, localDir: repository, platform: 'github' });
after(() => {
  GlobalConfig.set(previousGlobalConfig);
  rmSync(temporary, { recursive: true, force: true });
});

const preset: RenovateConfig = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));
const { config: resolved } = await resolveConfigPresets(preset);
const config = mergeChildConfig(getConfig(), {
  ...resolved,
  repository: 'test/renovate-config',
  semanticCommits: 'disabled',
});

// Versions below are synthetic SemVer fixtures, independent of installed tools.
function dep(name: string, updateType: UpdateType = 'minor', currentVersion = '1.0.0', newVersion = '1.1.0', datasource = 'npm'): PackageDependency {
  return {
    depName: name,
    packageName: name,
    datasource,
    currentValue: currentVersion,
    currentVersion,
    updates: [{
      updateType,
      newValue: newVersion,
      newVersion,
      newMajor: Number(newVersion.split('.')[0]),
      newMinor: Number(newVersion.split('.')[1]),
    }],
  };
}

async function updates(manager: string, dependencies: PackageDependency[], overrides: RenovateConfig = {}) {
  const result = await flattenUpdates({ ...config, ...overrides, semanticCommits: 'disabled' }, {
    [manager]: [{ packageFile: 'fixtures/dependencies', deps: dependencies }],
  });
  return result.filter((update) => !update.isLockFileMaintenance);
}

const technologies = [
  ['npm', 'npm'],
  ['mise', 'github-releases'],
  ['github-actions', 'github-tags'],
  ['cargo', 'crate'],
  ['pip_requirements', 'pypi'],
  ['pep621', 'pypi'],
  ['dockerfile', 'docker'],
  ['docker-compose', 'docker'],
] as const;

for (const [manager, datasource] of technologies) {
  test(`${manager} keeps unrelated updates separate and major updates manual`, async () => {
    const [a, b, major] = await updates(manager, [
      dep('example-a', 'minor', '1.0.0', '1.1.0', datasource),
      dep('example-b', 'patch', '1.0.0', '1.0.1', datasource),
      dep('example-a', 'major', '1.0.0', '2.0.0', datasource),
    ]);
    assert(a && b && major);
    assert.equal(a.groupName, null);
    assert.equal(b.groupName, null);
    assert.notEqual(a.branchName, b.branchName);
    assert.notEqual(major.branchName, a.branchName);
    assert.equal(a.automerge, true);
    assert.equal(b.automerge, true);
    assert.equal(major.automerge, false);
    assert.equal(a.minimumReleaseAge, '7 days');
    assert.equal(a.platformAutomerge, true);
    assert.equal(a.ignoreTests, false);
    assert.equal(a.rebaseWhen, 'auto');
  });
}

test('recommended related-package groups remain intact', async () => {
  const [a, b, unrelated] = await updates('npm', [
    dep('@types/react'),
    dep('@types/react-dom'),
    dep('example-unrelated'),
  ]);
  assert(a && b && unrelated);
  assert.equal(a.groupName, 'react monorepo');
  assert.equal(b.groupName, 'react monorepo');
  assert.equal(a.branchName, b.branchName);
  assert.notEqual(unrelated.branchName, a.branchName);
  assert.equal(a.automerge, true);
  assert.equal(b.automerge, true);
});

test('unrelated technologies keep separate PRs across managers', async () => {
  const [a, b, major] = await flattenUpdates(config, {
    gomod: [{ packageFile: 'go.mod', deps: [dep('example-go', 'minor', '1.0.0', '1.1.0', 'go')] }],
    pip_requirements: [{ packageFile: 'requirements.txt', deps: [
      dep('example-python', 'patch', '1.0.0', '1.0.1', 'pypi'),
      dep('example-python', 'major', '1.0.0', '2.0.0', 'pypi'),
    ] }],
  });
  assert(a && b);
  assert.equal(a.groupName, null);
  assert.equal(b.groupName, null);
  assert.notEqual(a.branchName, b.branchName);
  assert(major);
  assert.notEqual(major.branchName, a.branchName);
  assert.equal(major.automerge, false);
});

for (const updateType of ['minor', 'patch', 'digest', 'pin', 'pinDigest'] as const) {
  test(`${updateType} is eligible for automerge, including 0.x`, async () => {
    const [update] = await updates('npm', [dep('example-zero', updateType, '0.1.0', '0.2.0')]);
    assert(update);
    assert.equal(update.automerge, true);
    assert.equal(update.ignoreTests, false);
    assert.equal(update.platformAutomerge, true);
  });
}

test('Tuesday covers the whole JST day and excludes adjacent days', () => {
  assert(config.schedule?.[0]);
  for (const [iso, expected] of [
    ['2026-10-05T14:59:00Z', false],
    ['2026-10-05T15:00:00Z', true],
    ['2026-10-06T03:00:00Z', true],
    ['2026-10-06T14:59:00Z', true],
    ['2026-10-06T15:00:00Z', false],
  ] as const) {
    assert.equal(cronMatches(config.schedule[0], DateTime.fromISO(iso), config.timezone), expected, iso);
  }
});

test('ordinary releases wait seven days, including when their timestamp is unavailable', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(checkMinimumReleaseAge(config, new Date(Date.now() - 6 * day).toISOString()).isPending, true);
  assert.equal(checkMinimumReleaseAge(config, new Date(Date.now() - 8 * day).toISOString()).isPending, false);
  assert.equal(checkMinimumReleaseAge(config, null).isPending, true);
});

test('security fixes bypass schedule and release age while preserving the merge policy', async () => {
  // Renovate turns platform alerts into a matching rule with vulnerabilityAlerts
  // in force. Feed that rule through its real update-flattening pipeline.
  const alertConfig: RenovateConfig = {
    packageRules: [...(config.packageRules ?? []), {
      matchPackageNames: ['example-vulnerable'],
      isVulnerabilityAlert: true,
      force: config.vulnerabilityAlerts,
    }],
  };
  for (const [type, version, automerge] of [['patch', '1.0.1', true], ['minor', '1.1.0', true], ['major', '2.0.0', false]] as const) {
    const [update] = await updates('npm', [dep('example-vulnerable', type, '1.0.0', version)], alertConfig);
    assert(update);
    assert.equal(update.isVulnerabilityAlert, true);
    assert.deepEqual(update.schedule, []);
    assert.equal(isScheduledNow(update), true);
    assert.equal(checkMinimumReleaseAge(update, new Date().toISOString()).isPending, false);
    assert.equal(update.automerge, automerge);
    assert.equal(update.ignoreTests, false);
    assert.equal(update.platformAutomerge, true);
    assert.equal(update.groupName, null);
  }
});

test('weekly lockfile maintenance keeps platform-native automerge', async () => {
  const all = await flattenUpdates(config, { npm: [{ packageFile: 'package.json', deps: [] }] });
  const maintenance = all.find((update) => update.isLockFileMaintenance);
  assert(maintenance);
  assert.equal(maintenance.automerge, true);
  assert.equal(maintenance.ignoreTests, false);
  assert.equal(maintenance.platformAutomerge, true);
  assert.deepEqual(maintenance.schedule, ['* * * * 2']);
});

test('artifact status reports success as well as failure', async () => {
  const previous = platformApis.get('github')!;
  const statuses: BranchStatusConfig[] = [];
  try {
    platformApis.set('github', {
      ...previous,
      getBranchStatusCheck: async () => null,
      setBranchStatus: async status => { statuses.push(status); },
    });
    setPlatformApi('github');
    await setArtifactErrorStatus({ ...config, branchName: 'renovate/test', artifactErrors: [] });
    await setArtifactErrorStatus({ ...config, branchName: 'renovate/test', artifactErrors: [{ fileName: 'mise.lock', stderr: 'failed to regenerate' }] });
    assert.deepEqual(statuses.map(({ context, state }) => ({ context, state })), [
      { context: 'renovate/artifacts', state: 'green' },
      { context: 'renovate/artifacts', state: 'red' },
    ]);
  } finally {
    platformApis.set('github', previous);
    setPlatformApi('github');
  }
});

test('npm artifact generation selects the exact Node and pnpm versions declared in mise', async () => {
  const tools = await extractMise(readFileSync(new URL('../mise.toml', import.meta.url), 'utf8'), 'mise.toml');
  assert(tools);
  const pkg = lazyLoadPackageJson('.');
  const node = await getNodeToolConstraint(config, [], '.', pkg);
  const pnpm = getPackageManagerVersion('pnpm', await pkg.getValue());
  assert.equal(node.constraint, tools.deps.find(dep => dep.depName === 'node')?.currentValue);
  assert.equal(pnpm, tools.deps.find(dep => dep.depName === 'pnpm')?.currentValue);
  assert.match(node.constraint!, /^\d+\.\d+\.\d+$/);
  assert.match(pnpm!, /^\d+\.\d+\.\d+$/);
});

test('repository tool updates group npm and mise per tool and preserve manual majors', async () => {
  const ownConfig: RenovateConfig = JSON.parse(readFileSync(new URL('../renovate.json', import.meta.url), 'utf8'));
  const ownResolved = mergeChildConfig(config, await resolveLocalConfig(preset, ownConfig));
  const npm = await extractNpm(readFileSync(new URL('../package.json', import.meta.url), 'utf8'), 'package.json', {});
  const mise = await extractMise(readFileSync(new URL('../mise.toml', import.meta.url), 'utf8'), 'mise.toml');
  assert(npm && mise);
  for (const type of ['minor', 'major'] as const) {
    const decorate = (dependency: PackageDependency): PackageDependency => ({
      ...dependency,
      currentVersion: '1.0.0',
      updates: dep(dependency.depName!, type, '1.0.0', type === 'minor' ? '1.1.0' : '2.0.0').updates,
    });
    const result: BranchUpgradeConfig[] = (await flattenUpdates(ownResolved, {
      npm: [{ packageFile: 'package.json', deps: npm.deps.filter(dep => dep.depName === 'node' || dep.depName === 'pnpm').map(decorate) }],
      mise: [{ packageFile: 'mise.toml', deps: mise.deps.filter(dep => dep.depName === 'node' || dep.depName === 'pnpm').map(decorate) }],
    })).filter(update => !update.isLockFileMaintenance);
    assert.equal(result.length, 4);
    const node = result.filter(update => update.depName === 'node');
    const pnpm = result.filter(update => update.depName === 'pnpm');
    assert.equal(node[0]?.branchName, node[1]?.branchName);
    assert.equal(pnpm[0]?.branchName, pnpm[1]?.branchName);
    assert.notEqual(node[0]?.branchName, pnpm[0]?.branchName);
    assert(result.every(update => update.automerge === (type === 'minor')));
  }
});

test('repository mise tools use exact patch versions matching the lockfile', async () => {
  const extracted = await extractMise(readFileSync(new URL('../mise.toml', import.meta.url), 'utf8'), 'mise.toml');
  assert(extracted?.deps.length);
  assert.deepEqual(extracted.lockFiles, ['mise.lock']);
  for (const dependency of extracted.deps) {
    assert(dependency.currentValue && dependency.lockedVersion);
    assert.match(dependency.currentValue, /^\d+\.\d+\.\d+$/);
    assert.equal(dependency.currentValue, dependency.lockedVersion);
    assert.equal(dependency.allowedVersions, undefined);
    assert.notEqual(dependency.isLockfileOnly, true);
  }
});

test('mise lockfile updates preserve the major requests in the source config', async () => {
  // Consumers can still use major-only selectors with the shared preset.
  const content = '[tools]\nnode = "24"\n';
  const extracted = await extractMise(content, 'mise.toml');
  const node = extracted?.deps.find((dependency) => dependency.depName === 'node');
  assert(node?.lockedVersion);
  const [major, minor] = node.lockedVersion.split('.').map(Number);
  assert(major !== undefined && minor !== undefined);
  const newVersion = `${major}.${minor + 1}.0`;
  const result = updateLockedDependency({
    packageFile: 'mise.toml',
    packageFileContent: content,
    lockFile: 'mise.lock',
    lockFileContent: readFileSync(new URL('../mise.lock', import.meta.url), 'utf8'),
    depName: 'node',
    currentVersion: node.lockedVersion,
    newVersion,
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.files?.['mise.toml'], content);
  assert(result.files?.['mise.lock']?.includes(`version = "${newVersion}"`));
});

test('npm caret ranges keep in-range declarations and propose manual major updates', async () => {
  const extracted = await extractNpm(readFileSync(new URL('../package.json', import.meta.url), 'utf8'), 'package.json', {});
  assert(extracted?.deps.length);
  for (const dependency of extracted.deps.filter(dep => dep.depType === 'devDependencies')) {
    assert(dependency.currentValue);
    assert.match(dependency.currentValue, /^\^\d+\.\d+\.\d+$/);
  }
  const nodeTypes = extracted.deps.find((dependency) => dependency.depName === '@types/node');
  assert(nodeTypes?.currentValue);
  assert.equal(npmVersioning.matches('24.0.0', nodeTypes.currentValue), true);
  assert.equal(npmVersioning.matches('26.0.0', nodeTypes.currentValue), false);

  const ownConfig: RenovateConfig = JSON.parse(readFileSync(new URL('../renovate.json', import.meta.url), 'utf8'));
  const ownResolved = mergeChildConfig(config, await resolveLocalConfig(preset, ownConfig));
  const [minor, major] = await updates('npm', [
    { ...dep('example-range', 'minor', '1.0.0', '1.1.0'), currentValue: '^1.0.0' },
    { ...dep('example-range', 'major', '1.0.0', '2.0.0'), currentValue: '^1.0.0' },
  ], ownResolved);
  assert(minor?.rangeStrategy && major?.rangeStrategy);
  assert.equal(minor.rangeStrategy, 'update-lockfile');
  assert.equal(major.rangeStrategy, 'update-lockfile');
  assert.equal(npmVersioning.getNewValue({ currentValue: '^1.0.0', currentVersion: '1.0.0', newVersion: '1.1.0', rangeStrategy: minor.rangeStrategy }), '^1.0.0');
  assert.equal(npmVersioning.getNewValue({ currentValue: '^1.0.0', currentVersion: '1.0.0', newVersion: '2.0.0', rangeStrategy: major.rangeStrategy }), '^2.0.0');
  assert.equal(minor.automerge, true);
  assert.equal(major.automerge, false);
  assert.notEqual(minor.branchName, major.branchName);
});

test('local dry-run preserves presets before and after the repository preset', async () => {
  const local = { dependencyDashboard: false };
  const self = 'local>maya0513/renovate-config';
  const before = await resolveLocalConfig(local, { extends: [':dependencyDashboard', self] });
  const after = await resolveLocalConfig(local, { extends: [self, ':dependencyDashboard'] });
  const override = await resolveLocalConfig(local, { extends: [self, ':dependencyDashboard'], dependencyDashboard: false });
  assert.equal(before.dependencyDashboard, false);
  assert.equal(after.dependencyDashboard, true);
  assert.equal(override.dependencyDashboard, false);
});

test('local dry-run respects ignored presets and an absent self reference', async () => {
  const self = 'local>maya0513/renovate-config';
  const ignored = await resolveLocalConfig({ dependencyDashboard: false }, {
    extends: [self, ':dependencyDashboard'], ignorePresets: [self],
  });
  assert.equal(ignored.dependencyDashboard, true);
  const absent = await resolveLocalConfig({ automerge: true }, { extends: [':dependencyDashboard'] });
  assert.equal(absent.automerge, undefined);
  assert.equal(absent.dependencyDashboard, true);
});

test('GitHub Actions and reusable workflows are eligible for SHA pinning', async () => {
  const extracted = await extractActions(`jobs:
  mise-lock:
    uses: maya0513/renovate-config/.github/workflows/mise-lock.yml@main
  vite-plus-lock:
    uses: maya0513/renovate-config/.github/workflows/vite-plus-lock.yml@main
  external:
    uses: example/workflows/.github/workflows/check.yml@v1
  check:
    steps:
      - uses: actions/checkout@v7
      - uses: maya0513/renovate-config/example-action@v1
`, '.github/workflows/consumer.yml');
  assert.equal(extracted?.deps.length, 5);
  const dependencies = extracted!.deps.map(dependency => ({
    ...dependency,
    // Renovate normalizes this field between extraction and update flattening.
    packageName: dependency.packageName ?? dependency.depName,
    updates: [{ updateType: 'pinDigest' as const, newValue: dependency.currentValue ?? undefined, newDigest: 'a'.repeat(40) }],
  }));
  const result = await updates('github-actions', dependencies);
  assert.equal(result.length, 5);
  for (const update of result) {
    const shared = update.depName === 'maya0513/renovate-config' && update.depType === 'workflow';
    assert.equal(update.pinDigests, true);
    assert.equal(update.automerge, true);
    if (shared) assert.equal(update.currentValue, 'main');
  }
});

test('workflow actions use SHA pins with versioned release comments', async () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  const actions: PackageDependency[] = [];
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.yml'))) {
    const extracted = await extractActions(readFileSync(new URL(name, directory), 'utf8'), `.github/workflows/${name}`);
    actions.push(...(extracted?.deps.filter((dependency) => dependency.depType === 'action') ?? []));
  }
  assert(actions.length > 0);
  for (const action of actions) {
    assert(action.currentValue);
    assert.match(action.currentValue, /^v\d+\.\d+\.\d+$/);
    assert.match(action.currentDigest ?? '', /^[a-f0-9]{40}$/);
    assert.equal(action.datasource, 'github-tags');
    assert.equal(action.skipReason, undefined);
    assert.notEqual(action.enabled, false);
  }
});
