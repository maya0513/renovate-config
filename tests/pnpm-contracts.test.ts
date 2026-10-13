import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, git, write } from './helpers/pnpm-artifacts.ts';
import { fixture as viteFixture } from './helpers/viteplus.ts';

const failure = (pattern: RegExp) => (error: unknown) => {
  assert(error instanceof Error);
  const details = error as Error & { stdout?: string; stderr?: string };
  assert.match(`${error.message}\n${details.stdout ?? ''}\n${details.stderr ?? ''}`, pattern); return true;
};

test('default composition verifies even on a Mend push and does not publish', t => {
  const f = fixture(t, undefined, { NO_CHANGE: '1' });
  const mise = f.runComponent('mise-pnpm');
  assert.equal(JSON.parse(readFileSync(mise.outputs.state!, 'utf8')).verifyOnly, 'true');
  const result = f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state! });
  assert.equal(result.outputs.changed, 'false');
  assert.equal(result.outputs['artifact-id'], ''); f.assertUnpublished(); f.assertNoPayload();
});

test('default verification refuses generated differences rather than accepting repairs', t => {
  const f = fixture(t);
  const mise = f.runComponent('mise-pnpm');
  assert.throws(() => f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state! }), failure(/Dependency artifacts are out of date/));
  f.assertUnpublished(); f.assertNoPayload();
});

for (const [event, ref, sender] of [
  ['pull_request', 'refs/pull/1/merge', 29139614], ['workflow_dispatch', 'refs/heads/main', 29139614],
  ['push', 'refs/heads/main', 29139614], ['push', 'refs/heads/renovate/test', 123],
  ['push', 'refs/heads/renovate/test', 41898282],
] as const) {
  test(`update mode rejects event=${event}, ref=${ref}, sender=${sender} before preparation`, t => {
    const f = viteFixture(t, { aligned: true });
    write(f.root, 'event.json', JSON.stringify({ sender: { id: sender } }));
    for (const component of ['mise-pnpm', 'pnpm-viteplus']) {
      assert.throws(() => f.runComponent(component, { 'verify-only': 'false' }, { GITHUB_EVENT_NAME: event, GITHUB_REF: ref }),
        failure(/Updates require a Mend Renovate push/));
    }
    assert.equal(f.calls(), ''); assert.equal(readFileSync(f.log, 'utf8'), ''); f.assertUnpublished(); f.assertNoPayload();
  });
}

for (const verifyOnly of ['true', 'false']) {
  test(`Vite+ inherits mode=${verifyOnly} and prepared artifacts without a second mode input`, t => {
    const f = viteFixture(t, { aligned: true, miseChanges: true });
    const mise = f.runComponent('mise-pnpm', { 'verify-only': verifyOnly });
    const vite = f.runComponent('pnpm-viteplus', { 'preparation-state': mise.outputs.state! });
    assert.equal(JSON.parse(readFileSync(vite.outputs.state!, 'utf8')).verifyOnly, verifyOnly);
    if (verifyOnly === 'false') {
      const final = f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state!, 'viteplus-state': vite.outputs.state! });
      assert.equal(final.outputs.changed, 'true');
    } else assert.throws(() => f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state!, 'viteplus-state': vite.outputs.state! }), failure(/out of date/));
    f.assertUnpublished();
  });
}

test('Vite+ rejects an explicitly contradictory mode before pnpm execution', t => {
  const f = viteFixture(t, { aligned: true });
  const mise = f.runComponent('mise-pnpm', { 'verify-only': 'false' });
  assert.throws(() => f.runComponent('pnpm-viteplus', { 'preparation-state': mise.outputs.state!, 'verify-only': 'true' }), failure(/contradicts preparation state/));
  assert.equal(f.calls(), ''); f.assertUnpublished(); f.assertNoPayload();
});

test('independent Vite+ composition defaults to verification and never runs mise', t => {
  const f = viteFixture(t, { aligned: true });
  const vite = f.runComponent('pnpm-viteplus');
  assert.equal(JSON.parse(readFileSync(vite.outputs.state!, 'utf8')).verifyOnly, 'true');
  const result = f.runComponent('pnpm-outputs', { 'viteplus-state': vite.outputs.state! });
  assert.equal(result.outputs.changed, 'false'); assert.equal(readFileSync(f.log, 'utf8'), ''); f.assertUnpublished(); f.assertNoPayload();
});

interface Project { engines?: { node: string }; packageManager?: string }
for (const [name, mutate, reason] of [
  ['missing manager', (p: Project) => delete p.packageManager, /packageManager must declare pnpm/],
  ['pnpm range', (p: Project) => p.packageManager = 'pnpm@^12', /packageManager must declare pnpm/],
  ['different pnpm', (p: Project) => p.packageManager = 'pnpm@12.0.0', /locked pnpm version must match packageManager/],
  ['different manager', (p: Project) => p.packageManager = 'npm@12.10.1', /packageManager must declare pnpm/],
] satisfies [string, (p: Project) => unknown, RegExp][]) {
  test(`mise preparation rejects ${name} without repairing declarations`, t => {
    const f = fixture(t); const project = JSON.parse(readFileSync(join(f.repo, 'package.json'), 'utf8'));
    mutate(project); const declaration = JSON.stringify(project); write(f.repo, 'package.json', declaration);
    assert.throws(() => f.prepare(), failure(reason));
    assert.equal(readFileSync(join(f.repo, 'package.json'), 'utf8'), declaration); f.assertUnpublished(); f.assertNoPayload();
  });
}

test('a missing root package.json fails before any mise command', t => {
  const f = fixture(t); rmSync(join(f.repo, 'package.json'));
  assert.throws(() => f.prepare(), failure(/root package.json is required/));
  assert.equal(readFileSync(f.log, 'utf8'), ''); f.assertUnpublished(); f.assertNoPayload();
});

for (const engines of [undefined, { node: '^24 || ^26' }]) {
  test(`locked tools work with mise ranges and ${engines ? 'a Node compatibility range' : 'no engines declaration'}`, t => {
    const project = { engines, packageManager: 'pnpm@12.10.1' };
    const declaration = JSON.stringify(project);
    const f = fixture(t, {
      'mise.lock': 'initial lock\n', 'package.json': declaration,
      'mise.toml': '[tools]\nnode = "24"\npnpm = "12"\n',
    });
    f.update();
    assert.equal(readFileSync(join(f.repo, 'package.json'), 'utf8'), declaration);
  });
}

test('integrity suffixes are preserved while exact pnpm versions are checked', t => {
  const value = `pnpm@12.10.1+sha512.${'a'.repeat(128)}`;
  const f = fixture(t, { 'mise.lock': 'old\n', 'package.json': JSON.stringify({ engines: { node: process.versions.node }, packageManager: value }) });
  f.update(); assert.equal(JSON.parse(readFileSync(join(f.repo, 'package.json'), 'utf8')).packageManager, value);
});

test('the final check rejects a different pnpm version before creating a payload', t => {
  const f = fixture(t); const mise = f.runComponent('mise-pnpm', { 'verify-only': 'false' });
  write(f.root, 'other/pnpm', '#!/bin/sh\necho 12.0.0\n'); chmodSync(join(f.root, 'other/pnpm'), 0o755);
  appendFileSync(join(f.runnerTemp, 'path'), join(f.root, 'other') + '\n');
  assert.throws(() => f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state! }), failure(/running pnpm version must match the locked version/));
  f.assertUnpublished(); f.assertNoPayload();
});

test('a pnpm wrapper running the locked version passes final validation', t => {
  const f = fixture(t); const mise = f.runComponent('mise-pnpm', { 'verify-only': 'false' });
  write(f.root, 'wrapper/pnpm', '#!/bin/sh\nexec "$TEST_BIN/pnpm" "$@"\n');
  chmodSync(join(f.root, 'wrapper/pnpm'), 0o755);
  appendFileSync(join(f.runnerTemp, 'path'), join(f.root, 'wrapper') + '\n');
  f.runComponent('pnpm-outputs', { 'mise-state': mise.outputs.state! });
  assert.equal(f.outputs().changed, 'true');
  f.commitPrepared();
});

for (const tamper of ['base', 'components', 'component-type', 'paths', 'path-type', 'extra-key', 'missing', 'symlink'] as const) {
  test(`publisher rejects ${tamper} manifest before committing`, t => {
    const f = fixture(t); f.prepare(); const path = join(f.runnerTemp, 'pnpm-artifacts/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (tamper === 'base') manifest.base = '0'.repeat(40);
    if (tamper === 'components') manifest.components = ['mise-pnpm', 'pnpm-viteplus'];
    if (tamper === 'component-type') manifest.components = [['mise-pnpm']];
    if (tamper === 'paths') manifest.postUpdatePaths = ['unrelated.txt'];
    if (tamper === 'path-type') manifest.postUpdatePaths = [null];
    if (tamper === 'extra-key') manifest.execute = 'touch should-never-exist';
    write(f.runnerTemp, 'pnpm-artifacts/manifest.json', JSON.stringify(manifest));
    if (tamper === 'missing') rmSync(path);
    if (tamper === 'symlink') { rmSync(path); symlinkSync(join(f.repo, 'package.json'), path); }
    assert.throws(() => f.commitPrepared(), failure(/publishing manifest|Publishing manifest/));
    assert(!existsSync(join(f.repo, 'should-never-exist'))); f.assertUnpublished();
  });
}

test('publisher detects omitted Vite+ permission even when only mise locks changed', t => {
  const f = viteFixture(t, { aligned: true, miseChanges: true }); f.prepare();
  assert.throws(() => f.commitPrepared({ HAS_VITEPLUS: 'false' }), failure(/Publishing manifest exceeds explicit permissions/));
  f.assertUnpublished();
});

test('publisher accepts selected components and output paths within a broader authorization', t => {
  const f = fixture(t, undefined, {
    POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs/reference.txt',
  });
  f.prepare();
  f.commitPrepared({ HAS_VITEPLUS: 'true', POST_UPDATE_PATHS: 'generated docs\nother allowed outputs' });
  const changed = git(f.repo, 'diff', '--name-only', f.base, 'HEAD').split('\n');
  assert.deepEqual(changed.sort(), ['generated docs/reference.txt', 'mise.lock']);
});

for (const requested of ['generated docs-extra/file', 'generated docs/../unrelated.txt', 'unrelated.txt']) {
  test(`publisher rejects output request outside its directory permission: ${requested}`, t => {
    const f = fixture(t); f.prepare();
    const path = join(f.runnerTemp, 'pnpm-artifacts/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.postUpdatePaths = [requested];
    write(f.runnerTemp, 'pnpm-artifacts/manifest.json', JSON.stringify(manifest));
    assert.throws(() => f.commitPrepared({ POST_UPDATE_PATHS: 'generated docs' }), failure(/Publishing manifest exceeds explicit permissions/));
    f.assertUnpublished();
  });
}

test('equivalent explicit output paths match without widening publishing permission', t => {
  const paths = './generated docs/\r\n\n';
  const f = fixture(t, undefined, { POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: paths }); f.prepare();
  f.commitPrepared({ POST_UPDATE_PATHS: 'generated docs' });
  assert(!git(f.repo, 'diff', '--name-only', f.base, 'HEAD').includes('unrelated.txt'));
  assert.deepEqual(JSON.parse(readFileSync(join(f.runnerTemp, 'pnpm-artifacts/manifest.json'), 'utf8')).postUpdatePaths, ['generated docs']);
});

test('final validation rejects independently prepared states with different modes', t => {
  const f = viteFixture(t, { aligned: true });
  const mise = f.runComponent('mise-pnpm', { 'verify-only': 'false' });
  const vite = f.runComponent('pnpm-viteplus');
  const before = readFileSync(f.log, 'utf8');
  assert.throws(() => f.runComponent('pnpm-outputs', {
    'mise-state': mise.outputs.state!, 'viteplus-state': vite.outputs.state!, 'post-update-task': 'generate',
  }), failure(/same commit, repository and verify-only mode/));
  assert.equal(readFileSync(f.log, 'utf8'), before); f.assertUnpublished(); f.assertNoPayload();
});

test('locked pnpm version mismatch fails despite matching declaration and executable', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare({ TEST_LOCKED_PNPM_VERSION: '12.0.0' }), failure(/locked pnpm version must match packageManager/));
  f.assertUnpublished(); f.assertNoPayload();
});

test('an actually different Node executable fails even if metadata claims the declared version', t => {
  const versions = JSON.parse(execFileSync('mise', ['-C', fileURLToPath(new URL('./fixtures/', import.meta.url)), 'ls', '--current', '--json', 'node'], { encoding: 'utf8' }));
  const different = versions.find((tool: { version: string }) => tool.version !== process.versions.node);
  assert(different?.installed, 'Run mise run test:tools');
  const f = fixture(t);
  assert.throws(() => f.prepare({ TEST_NODE_HOME: different.install_path, TEST_LOCKED_NODE_VERSION: process.versions.node }),
    failure(/running node version must match the locked version/));
  f.assertUnpublished(); f.assertNoPayload();
});

test('a forged manifest cannot authorize unrelated payload paths', t => {
  const f = fixture(t); f.prepare();
  write(f.repo, 'unrelated.txt', 'forged output\n'); git(f.repo, 'add', 'unrelated.txt');
  write(f.runnerTemp, 'pnpm-artifacts/changes.patch', f.runScript('git diff --cached --binary --full-index'));
  // Match the authorized manifest exactly: the publisher still reconstructs
  // its allowlist independently rather than trusting the payload metadata.
  write(f.runnerTemp, 'pnpm-artifacts/manifest.json', JSON.stringify({ base: f.base, components: ['mise-pnpm'], postUpdatePaths: [] }));
  assert.throws(() => f.commitPrepared(), failure(/disallowed path: unrelated.txt/));
  f.assertUnpublished();
});

test('mise pnpm takes precedence over a pnpm shim beside the selected Node executable', t => {
  const f = fixture(t);
  write(f.root, 'selected-node/bin/pnpm', '#!/bin/sh\necho unexpected-node-pnpm-shim >&2\nexit 99\n');
  chmodSync(join(f.root, 'selected-node/bin/pnpm'), 0o755);
  f.prepare();
  assert.equal(f.runScript('command -v pnpm').trim(), join(f.bin, 'pnpm'));
  f.assertUnpublished();
});
