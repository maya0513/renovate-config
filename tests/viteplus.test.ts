import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { fixture, type ViteplusOptions } from './helpers/viteplus.ts';
import { git, prepareJob, pnpmWorkflow, publishJob, readWorkflow, write } from './helpers/pnpm-artifacts.ts';

test('Vite+ preparation is independent of mise and publishing credentials', () => {
  const action = parse(readFileSync(new URL('../.github/actions/pnpm-viteplus/action.yml', import.meta.url), 'utf8'));
  assert(!JSON.stringify(action).includes('mise install'));
  assert(!JSON.stringify(action).includes('app-private-key'));
  assert.equal(action.inputs['verify-only'].default, '');
  assert(!JSON.stringify(prepareJob).includes('app-private-key'));
  assert(!JSON.stringify(publishJob).includes('pnpm install'));
  const token = publishJob.steps.find((step: { id?: string }) => step.id === 'app-token') as any;
  assert.equal(token.with['permission-contents'], 'write');
  assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
});

test('aligned declarations repair only the lockfile without running package scripts', t => {
  const f = fixture(t);
  f.update();
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'pnpm-lock.yaml');
  assert.match(f.calls(), /"update","@vitest\/coverage-v8@5.0.1","--no-save"/);
  for (const call of f.calls().trim().split('\n').map(line => JSON.parse(line) as string[])) {
    for (const flag of ['--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error']) assert(call.includes(flag));
    assert(!call.some(flag => flag.includes('manage-package-manager-versions')));
  }
});
test('aligned verification needs no credentials and creates no payload, commit or push', t => {
  const f = fixture(t, { aligned: true });
  f.update({ VERIFY_ONLY: 'true' });
  assert.equal(f.outputs().changed, 'false');
  f.assertUnpublished();
  assert(!existsSync(join(f.runnerTemp, 'pnpm-artifacts/changes.patch')));
  assert(!f.calls().includes('"update"'));
});
for (const declarations of [false, true]) {
  test(`stale Vite+ ${declarations ? 'declarations' : 'graph'} fails verification without repair`, t => {
    const f = fixture(t, { declarations, exact: declarations });
    assert.throws(() => f.update({ VERIFY_ONLY: 'true' }), error => {
      assert(error instanceof Error && 'stderr' in error);
      assert.match(String(error.stderr), declarations ? /Vite\+ declarations are out of date/ : /Coverage and bundled Vitest differ/);
      return true;
    });
    assert.equal(git(f.repo, 'status', '--porcelain'), '');
    const calls = f.calls().trim().split('\n').map(line => JSON.parse(line) as string[]);
    assert(calls.every(call => call[0] === 'install' && call.includes('--frozen-lockfile')));
    f.assertUnpublished(); f.assertNoPayload();
  });
}

for (const miseChanges of [false, true]) {
  test(`prepared tools take precedence over ambient pnpm (mise locks change=${miseChanges})`, t => {
    const f = fixture(t, { aligned: true, miseChanges });
    const selected = join(f.root, 'selected-pnpm');
    mkdirSync(selected);
    renameSync(join(f.bin, 'pnpm'), join(selected, 'pnpm'));
    write(f.bin, 'pnpm', '#!/bin/sh\necho ambient-pnpm-must-not-run >&2\nexit 99\n');
    // The ambient file need not be executable: the selected directory must win.
    f.update({ TEST_BIN: selected, NO_CHANGE: '1', VERIFY_ONLY: 'true' });
    assert.equal(f.runScript('command -v node'), join(f.root, 'selected-node/bin/node') + '\n');
    assert.equal(f.runScript('command -v pnpm'), join(selected, 'pnpm') + '\n');
    assert.match(f.calls(), /--frozen-lockfile/);
    f.assertUnpublished(); f.assertNoPayload();
  });
}
test('pnpm settings documents and wildcard overrides are not runner resolutions', t => {
  const f = fixture(t, { aligned: true });
  write(f.repo, 'pnpm-lock.yaml', "---\nlockfileVersion: '9.0'\n---\nlockfileVersion: '9.0'\noverrides:\n  vitest@*: 5.0.1\npackages:\n  vitest@5.0.1:\n  coverage@5.0.1:\n");
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'pnpm settings document');
  f.update({ VERIFY_ONLY: 'true' });
  assert.equal(f.outputs().changed, 'false');
  assert(!f.calls().includes('"update"'));
});
test('exact declarations synchronize coverage, both overrides and the lockfile', t => {
  const f = fixture(t, { exact: true, declarations: true });
  f.update();
  assert.equal(JSON.parse(readFileSync(join(f.repo, 'package.json'), 'utf8')).devDependencies['@vitest/coverage-v8'], '5.0.2');
  const workspace = parse(readFileSync(join(f.repo, 'pnpm-workspace.yaml'), 'utf8'));
  assert.equal(workspace.overrides['vitest@*'], '5.0.2');
  assert.equal(workspace.overrides['vite@*'], 'npm:@voidzero-dev/vite-plus-core@1.0.1');
  assert.equal(workspace.peerDependencyRules.allowedVersions.vite, '1');
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'package.json\npnpm-lock.yaml\npnpm-workspace.yaml');
});
test('mise and Vite+ changes produce one commit and the App push can be verified', t => {
  const f = fixture(t, { exact: true, declarations: true, miseChanges: true });
  f.update();
  assert.equal(git(f.repo, 'rev-list', '--count', `${f.base}..HEAD`), '1');
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'mise.lock\npackage.json\npnpm-lock.yaml\npnpm-workspace.yaml');
  f.run('push');
  f.update({ VERIFY_ONLY: 'true', NO_CHANGE: '1' });
  assert.equal(f.outputs().changed, 'false');
  const calls = f.calls().trim().split('\n').map(line => JSON.parse(line) as string[]);
  assert(calls.every(call => call.includes('--pm-on-fail=error')));
});
for (const options of [{ duplicate: true, aligned: true }, { instance: true, aligned: true }, { symlink: true }]) {
  test(`repairs and verifies fresh graph resolutions ${JSON.stringify(options)}`, t => {
    const f = fixture(t, options); f.update();
    assert.match(f.calls(), /"update"/);
    assert.equal(f.outputs().changed, options.instance ? 'false' : 'true');
  });
}
for (const [name, options] of [
  ['Vitest major change', { major: true }], ['nonexact bundled Vitest', { invalid: true }],
  ['nonexact bundled Vite', { exact: true, declarations: true, invalidCore: true }],
  ['native Vite alias', { alias: true }], ['pnpm failure', { fail: true }], ['unrepaired graph', { unfixed: true }],
  ['declaration mutation', { mutate: true }], ['unrelated files', { unrelated: true }],
  ['unrelated transitive version change', { unrelatedVersion: true }],
  ['Vite+ version change', { viteChanged: true }],
] satisfies [string, ViteplusOptions][]) {
  test(`rejects ${name} before committing`, t => { const f = fixture(t, options); assert.throws(() => f.update()); f.assertUnpublished(); });
}
test('ambiguous override selectors fail instead of rewriting unrelated YAML', t => {
  const f = fixture(t, { exact: true, declarations: true });
  write(f.repo, 'pnpm-workspace.yaml', "overrides:\n  vite: 'npm:@voidzero-dev/vite-plus-core@1.0.0'\n  'vite@*': 'npm:@voidzero-dev/vite-plus-core@1.0.0'\n");
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'ambiguous input');
  assert.throws(() => f.update());
});

for (const [name, workspace, message] of [
  ['flow mapping', "overrides: { vite: '1' }\n", /plain overrides block/],
  ['anchored scalar', "overrides:\n  vite: &core '1'\n", /Unsupported vite override scalar/],
  ['aliased scalar', "core: &core '1'\noverrides:\n  vite: *core\n", /Unsupported vite override scalar/],
] as const) {
  test(`declaration synchronization rejects ${name} with a clear error`, t => {
    const f = fixture(t, { exact: true, declarations: true, workspace });
    assert.throws(() => f.update(), error => {
      assert(error instanceof Error && 'stderr' in error);
      assert.match(String(error.stderr), message);
      return true;
    });
    f.assertUnpublished();
  });
}

test('declaration synchronization inserts missing overrides and preserves neighboring settings', t => {
  const f = fixture(t, {
    exact: true, declarations: true,
    workspace: "overrides:\n  other: '1'\npeerDependencyRules:\n  allowedVersions:\n    vite: '1'\n",
  });
  f.update();
  assert.deepEqual(parse(readFileSync(join(f.repo, 'pnpm-workspace.yaml'), 'utf8')), {
    overrides: { other: '1', 'vite@*': 'npm:@voidzero-dev/vite-plus-core@1.0.1', 'vitest@*': '5.0.2' },
    peerDependencyRules: { allowedVersions: { vite: '1' } },
  });
});

test('final validation catches post-task corruption of synchronized declarations', t => {
  const f = fixture(t, { miseChanges: true }); f.run('locks', f.env); f.run('sync', f.env);
  write(f.repo, 'package.json', '{}\n'); assert.throws(() => f.run('update', f.env));
  f.assertUnpublished();
});

test('final validation catches post-task corruption of the installed graph', t => {
  const f = fixture(t, { aligned: true });
  f.run('locks');
  f.run('sync');
  f.pkg('@vitest/coverage-v8', { name: '@vitest/coverage-v8', version: '5.0.9' });
  assert.throws(() => f.run('update'), error => {
    assert(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /Coverage and bundled Vitest differ/);
    return true;
  });
  f.assertUnpublished();
});
test('publisher rejects a different base and symlink payload', t => {
  const f = fixture(t); f.prepare();
  assert.throws(() => f.commitPrepared({ ...f.env, BASE_SHA: '0'.repeat(40) }));
  const payload = join(f.runnerTemp, 'pnpm-artifacts/changes.patch');
  rmSync(payload); symlinkSync(join(f.repo, 'package.json'), payload);
  assert.throws(() => f.commitPrepared(f.env));
  f.assertUnpublished();
});
test('publication retries use the immutable artifact ID of the successful preparation', () => {
  const action = parse(readFileSync(new URL('../.github/actions/pnpm-outputs/action.yml', import.meta.url), 'utf8'));
  const upload = action.runs.steps.find((step: { id?: string }) => step.id === 'upload');
  const download = publishJob.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/download-artifact@')) as any;
  assert.equal(action.outputs['artifact-id'].value, '${{ steps.upload.outputs.artifact-id }}');
  assert.equal(download.with['artifact-ids'], '${{ inputs.artifact-id }}');
  assert.equal(download.with.name, undefined); assert.match(upload.with.name, /run_id.*run_attempt/);
});

test('Vite+ component uses prepared pnpm without calling mise', t => {
  const f = fixture(t, { aligned: true });
  f.runComponent('pnpm-viteplus', { 'verify-only': 'true' });
  assert.equal(readFileSync(f.log, 'utf8'), '');
  assert.match(f.calls(), /--frozen-lockfile/);
  f.assertUnpublished(); f.assertNoPayload();
});

for (const value of ['yes', '1']) {
  test(`Vite+ component rejects invalid verify-only ${JSON.stringify(value)}`, t => {
    const f = fixture(t, { aligned: true });
    assert.throws(() => f.runComponent('pnpm-viteplus', { 'verify-only': value }), /verify-only must be true or false/);
    assert.equal(f.calls(), ''); f.assertUnpublished(); f.assertNoPayload();
  });
}
