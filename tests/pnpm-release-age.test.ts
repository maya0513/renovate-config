import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { parse, parseAllDocuments } from 'yaml';
import { packageRegistry } from './helpers/package-registry.ts';
import { fixture as artifactFixture, git, write } from './helpers/pnpm-artifacts.ts';

const actionPath = new URL('../.github/actions/pnpm-outputs/', import.meta.url).pathname;
const action = parse(readFileSync(join(actionPath, 'action.yml'), 'utf8'));
const policyStep = action.runs.steps.find((step: { id?: string }) => step.id === 'policy');
const policy = 'minimumReleaseAge: 10080\nminimumReleaseAgeStrict: true\nminimumReleaseAgeIgnoreMissingTime: false\n';
// Six-day-old releases pass pnpm's built-in one-day delay, but must still fail
// our seven-day policy. An eight-day-old release must remain selectable.
const fresh = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
const mature = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

function fixture(t: TestContext, manager = 'current') {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-release-age-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const managerPath = manager === 'current' ? undefined : execFileSync('mise', [
    '-C', fileURLToPath(new URL('./fixtures/', import.meta.url)), 'where', `pnpm@${manager}`,
  ], { encoding: 'utf8' }).trim();
  const version = execFileSync(managerPath ? join(managerPath, 'pnpm') : 'pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
  const project = { name: 'release-age-fixture', private: true, packageManager: `pnpm@${version}`, dependencies: {} as Record<string, string> };
  writeFileSync(join(root, 'package.json'), JSON.stringify(project));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), policy);
  // Do not inherit user registries, auth or policy overrides into test cases.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:pnpm|npm)_config_/i.test(key)));
  Object.assign(env, {
    PATH: managerPath ? `${managerPath}:${process.env.PATH}` : process.env.PATH,
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'),
    npm_config_userconfig: join(root, 'user.npmrc'),
    CI: 'true', ACTION_PATH: actionPath,
  });
  const check = (extra: NodeJS.ProcessEnv = {}) => spawnSync('bash', ['-c', policyStep.run], {
    cwd: root, env: { ...env, ...extra }, encoding: 'utf8',
  });
  return { root, project, env, check, version };
}

for (const [name, yaml, passes] of [
  ['seven days', policy, true],
  ['fourteen days', policy.replace('10080', '20160'), true],
  ['native strict default', policy.replace('minimumReleaseAgeStrict: true\n', ''), true],
  ['missing age', policy.replace('minimumReleaseAge: 10080\n', ''), false],
  ['six days', policy.replace('10080', '8640'), false],
  ['non-strict mode', policy.replace('Strict: true', 'Strict: false'), false],
  ['missing publication times allowed', policy.replace('IgnoreMissingTime: false', 'IgnoreMissingTime: true'), false],
  ['default missing-time bypass', policy.replace('minimumReleaseAgeIgnoreMissingTime: false\n', ''), false],
  ['trusted lockfile bypass', `${policy}trustLockfile: true\n`, false],
  ['explicit locked validation', `${policy}trustLockfile: false\n`, true],
  ['version-specific security exception', `${policy}minimumReleaseAgeExclude:\n  - example@1.2.3\n`, true],
  ['scoped exact prerelease exception', `${policy}minimumReleaseAgeExclude:\n  - '@example/tool@1.2.3-rc.1'\n`, true],
  ['package-wide exception', `${policy}minimumReleaseAgeExclude:\n  - example\n`, false],
  ['wildcard exception', `${policy}minimumReleaseAgeExclude:\n  - '@example/*'\n`, false],
  ['version range exception', `${policy}minimumReleaseAgeExclude:\n  - 'example@^1.2.3'\n`, false],
] as const) {
  test(`pnpm release-age action ${passes ? 'accepts' : 'rejects'} ${name} without modifying files`, t => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'pnpm-workspace.yaml'), yaml);
    const before = readFileSync(join(f.root, 'package.json'), 'utf8');
    const result = f.check();
    assert.equal(result.status, passes ? 0 : 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /pnpm release-age policy/);
    assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), yaml);
    assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), before);
  });
}

test('pnpm release-age action rejects an absent workspace configuration', t => {
  const f = fixture(t);
  rmSync(join(f.root, 'pnpm-workspace.yaml'));
  const result = f.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Add pnpm-workspace.yaml/);
});

for (const override of [
  { pnpm_config_minimum_release_age: '0' },
  { PNPM_CONFIG_MINIMUM_RELEASE_AGE: '60' },
  { pnpm_config_minimum_release_age_strict: 'false' },
  { pnpm_config_minimum_release_age_ignore_missing_time: 'true' },
  { pnpm_config_trust_lockfile: 'true' },
]) {
  test(`pnpm release-age action rejects weaker effective environment settings: ${Object.keys(override)[0]}`, t => {
    const f = fixture(t);
    const result = f.check(override);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
}

test('pnpm release-age action never prints registry credentials', t => {
  const f = fixture(t);
  const secret = 'policy-test-token-that-must-not-be-printed';
  writeFileSync(join(f.root, 'pnpm-workspace.yaml'), policy.replace('10080', '0'));
  writeFileSync(join(f.root, '.npmrc'), `//registry.npmjs.org/:_authToken=${secret}\n`);
  const result = f.check();
  assert.equal(result.status, 1);
  assert(!`${result.stdout}${result.stderr}`.includes(secret));
});

for (const manager of ['current', '12.10.1']) {
test(`real pnpm (${manager}) enforces seven days during maintenance and native in-range updates, with only the reviewed security version exempted`, { timeout: 60_000 }, async t => {
  const f = fixture(t, manager);
  const registry = await packageRegistry(t, f.root, [f.version]);
  registry.publish('ordinary', '1.0.0', { transitive: '^1.0.0' });
  registry.publish('ordinary', '1.0.1', { transitive: '^1.0.0' }, mature);
  registry.publish('ordinary', '1.0.2', { transitive: '^1.0.0' }, fresh);
  registry.publish('transitive', '1.0.1', {}, fresh);
  registry.publish('security-fix', '1.0.0', { transitive: '^1.0.0' });
  registry.publish('security-fix', '1.0.1', { transitive: '^1.0.0' }, fresh);
  const env = { ...f.env, ...registry.env };
  const pnpm = (...args: string[]) => execFileSync('pnpm', [...args, '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
    cwd: f.root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  f.project.dependencies = { ordinary: '^1.0.0', 'security-fix': '^1.0.0' };
  const manifest = JSON.stringify(f.project);
  writeFileSync(join(f.root, 'package.json'), manifest);
  assert.equal(f.check(registry.env).status, 0);
  pnpm('install', '--lockfile-only', '--no-frozen-lockfile');
  const versions = (name: string) => Object.keys(parseAllDocuments(readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8')).at(-1)!.toJS().packages)
    .filter(key => key.startsWith(`${name}@`));
  assert.deepEqual(versions('ordinary'), ['ordinary@1.0.1']);
  assert.deepEqual(versions('transitive'), ['transitive@1.0.0']);
  assert.deepEqual(versions('security-fix'), ['security-fix@1.0.0']);
  // Renovate's update-lockfile strategy uses this exact native command shape.
  pnpm('update', '--no-save', 'ordinary@1.0.1', '--lockfile-only');
  assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), manifest);
  assert.throws(() => pnpm('update', '--no-save', 'security-fix@1.0.1', '--lockfile-only'), error => {
    assert(error instanceof Error && 'stdout' in error && 'stderr' in error);
    assert.match(String(error.stdout) + String(error.stderr), /release.age|immature/i);
    return true;
  });
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), policy, 'A failed update must not approve its own exception');
  const exception = `${policy}minimumReleaseAgeExclude:\n  # Reviewed urgent fix: only this version is approved.\n  - security-fix@1.0.1\n`;
  writeFileSync(join(f.root, 'pnpm-workspace.yaml'), exception);
  assert.equal(f.check(registry.env).status, 0);
  pnpm('update', '--no-save', 'security-fix@1.0.1', '--lockfile-only');
  assert.deepEqual(versions('security-fix'), ['security-fix@1.0.1']);
  assert.deepEqual(versions('transitive'), ['transitive@1.0.0']);
  assert.deepEqual(versions('ordinary'), ['ordinary@1.0.1']);
  pnpm('install', '--frozen-lockfile');
  // Lockfile maintenance deletes and regenerates the graph, using the same
  // policy and the same version-specific exception as ordinary installs.
  rmSync(join(f.root, 'pnpm-lock.yaml'));
  pnpm('install', '--lockfile-only', '--no-frozen-lockfile');
  assert.deepEqual(versions('security-fix'), ['security-fix@1.0.1']);
  assert.deepEqual(versions('ordinary'), ['ordinary@1.0.1']);
  assert.deepEqual(versions('transitive'), ['transitive@1.0.0']);
  assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), manifest);
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), exception);
});

test(`real pnpm (${manager}) frozen validation rejects an immature locked graph without repairing it`, { timeout: 60_000 }, async t => {
  const f = fixture(t, manager);
  const registry = await packageRegistry(t, f.root, [f.version]);
  registry.publish('immature', '1.0.0', {}, fresh);
  const env = { ...f.env, ...registry.env };
  const run = (...args: string[]) => execFileSync('pnpm', [...args, '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
    cwd: f.root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  f.project.dependencies = { immature: '1.0.0' };
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(f.project));
  writeFileSync(join(f.root, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 0\n');
  run('install', '--no-frozen-lockfile');
  const locked = readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8');
  writeFileSync(join(f.root, 'pnpm-workspace.yaml'), policy);
  assert.equal(f.check(registry.env).status, 0);
  assert.throws(() => run('install', '--frozen-lockfile'), error => {
    assert(error instanceof Error && 'stdout' in error && 'stderr' in error);
    assert.match(String(error.stdout) + String(error.stderr), /release.age|immature/i);
    return true;
  });
  assert.equal(readFileSync(join(f.root, 'pnpm-lock.yaml'), 'utf8'), locked);
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), policy);
});

test(`real pnpm (${manager}) rejects registry dependencies without publication timestamps`, { timeout: 60_000 }, async t => {
  const f = fixture(t, manager);
  const registry = await packageRegistry(t, f.root, [f.version]);
  registry.publish('undated', '1.0.0', {}, null);
  f.project.dependencies = { undated: '1.0.0' };
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(f.project));
  const result = spawnSync('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
    cwd: f.root, env: { ...f.env, ...registry.env }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /MISSING_TIME|publication|publish.*time/i);
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), policy);
});

test(`real pnpm (${manager}) rejects immature exact dependencies bundled by an aged Vite+ release`, { timeout: 60_000 }, async t => {
  const f = fixture(t, manager);
  const registry = await packageRegistry(t, f.root, [f.version]);
  registry.publish('vitest', '5.0.2', {}, fresh);
  f.project.dependencies = { 'vite-plus': '1.0.1' };
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(f.project));
  const result = spawnSync('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
    cwd: f.root, env: { ...f.env, ...registry.env }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /vitest|release.age|immature/i);
  assert.equal(readFileSync(join(f.root, 'pnpm-workspace.yaml'), 'utf8'), policy);
});
}

test('pnpm-outputs alone verifies policy and the frozen graph without mise, resetting the index or publishing on a Mend push', { timeout: 60_000 }, async t => {
  const f = artifactFixture(t, { '.gitignore': 'node_modules/\n' });
  const registry = await packageRegistry(t, f.root);
  const executable = execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim();
  rmSync(join(f.bin, 'pnpm')); symlinkSync(executable, join(f.bin, 'pnpm'));
  write(f.repo, 'package.json', JSON.stringify({ name: 'plain-pnpm', private: true, packageManager: `pnpm@${registry.pnpmVersion}`, dependencies: { ordinary: '1.0.0' } }));
  execFileSync(executable, ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
    cwd: f.repo, env: { ...process.env, ...registry.env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'plain pnpm locked graph');
  const candidate = git(f.repo, 'rev-parse', 'HEAD');
  const locked = readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8');
  write(f.repo, 'staged.txt', 'leave the index intact\n'); git(f.repo, 'add', 'staged.txt');
  const staged = git(f.repo, 'diff', '--cached', '--binary');
  const result = f.runComponent('pnpm-outputs', {}, registry.env);
  assert.equal(result.outputs.changed, 'false');
  assert.equal(result.outputs['artifact-id'], '');
  assert.equal(readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8'), locked);
  assert.equal(git(f.repo, 'diff', '--cached', '--binary'), staged);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), candidate);
  assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), f.base);
  assert.equal(readFileSync(f.log, 'utf8'), '');
  f.assertNoPayload();
  // An empty input set must still perform frozen installation, not just config
  // inspection. Missing the required lockfile fails without generating it.
  rmSync(join(f.repo, 'pnpm-lock.yaml'));
  assert.throws(() => f.runComponent('pnpm-outputs', {}, registry.env), error => {
    assert(error instanceof Error && 'stdout' in error && 'stderr' in error);
    assert.match(String(error.stdout) + String(error.stderr), /FROZEN_LOCKFILE|frozen.lockfile|lockfile.*missing/i);
    return true;
  });
  f.assertNoPayload();
});

test('pnpm-outputs alone rejects missing policy before attempting dependency installation', t => {
  const f = artifactFixture(t);
  rmSync(join(f.repo, 'pnpm-workspace.yaml'));
  assert.throws(() => f.runComponent('pnpm-outputs'), error => {
    assert(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /Add pnpm-workspace.yaml/);
    return true;
  });
  f.assertNoPayload(); f.assertUnpublished();
});
