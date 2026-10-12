import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { fixture, type VitePlusOptions } from './helpers/vite-plus.ts';
import { git, prepareJob, dependencyArtifactsWorkflow, publishJob, readWorkflow, write } from './helpers/dependency-artifacts.ts';

test('Vite+ compatibility wrapper shares the engine and isolates App credentials from dependencies', () => {
  const wrapper = readWorkflow('vite-plus');
  assert.equal(wrapper.jobs.prepare.uses, '$/.github/workflows/dependency-artifacts.yml');
  assert.equal(wrapper.jobs.prepare.with['mise-enabled'], false);
  assert.equal(wrapper.jobs.prepare.with['sync-vite-plus'], true);
  for (const [key, value] of [['sync-declarations', false], ['node-version', '24'], ['pnpm-version', '12']]) assert.equal(wrapper.on.workflow_call.inputs[key as string].default, value);
  assert.equal(wrapper.on.workflow_call.secrets['app-private-key'].required, false);
  assert(!JSON.stringify(prepareJob).includes('app-private-key'));
  assert(!JSON.stringify(publishJob).includes('pnpm install'));
  const workflow = dependencyArtifactsWorkflow;
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.publish.needs, 'prepare');
  const token = workflow.jobs.publish.steps.find((step: { id?: string }) => step.id === 'app-token');
  assert.equal(token.with['permission-contents'], 'write');
  assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
});

test('legacy major declarations repair only the lockfile without running package scripts', t => {
  const f = fixture(t);
  f.update();
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'pnpm-lock.yaml');
  assert.match(f.calls(), /"update","@vitest\/coverage-v8@5.0.1","--no-save"/);
  for (const call of f.calls().trim().split('\n').map(line => JSON.parse(line) as string[])) {
    for (const flag of ['--ignore-scripts', '--ignore-pnpmfile', '--config.manage-package-manager-versions=false']) assert(call.includes(flag));
  }
});
test('aligned verification needs no credentials and creates no payload, commit or push', t => {
  const f = fixture(t, { aligned: true });
  f.update({ VERIFY_ONLY: 'true' });
  assert.equal(f.outputs().changed, 'false');
  f.assertUnpublished();
  assert(!existsSync(join(f.runnerTemp, 'dependency-artifacts/changes.patch')));
  assert(!f.calls().includes('"update"'));
});
test('stale coverage fails verification without committing or pushing', t => {
  const f = fixture(t);
  assert.throws(() => f.update({ VERIFY_ONLY: 'true' }));
  f.assertUnpublished();
});
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
test('combined mise and Vite+ changes produce one commit and the App push can be verified', t => {
  const f = fixture(t, { exact: true, declarations: true, combined: true });
  f.update();
  assert.equal(git(f.repo, 'rev-list', '--count', `${f.base}..HEAD`), '1');
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'mise.lock\npackage.json\npnpm-lock.yaml\npnpm-workspace.yaml');
  f.run('push');
  f.update({ VERIFY_ONLY: 'true', NO_CHANGE: '1' });
  assert.equal(f.outputs().changed, 'false');
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
  ['Vite+ version change', { viteChanged: true }], ['exact coverage without opt-in', { exact: true }],
] satisfies [string, VitePlusOptions][]) {
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
  const f = fixture(t, { combined: true }); f.run('locks', f.env); f.run('sync', f.env);
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
  const payload = join(f.runnerTemp, 'dependency-artifacts/changes.patch');
  rmSync(payload); symlinkSync(join(f.repo, 'package.json'), payload);
  assert.throws(() => f.commitPrepared(f.env));
  f.assertUnpublished();
});
test('publication retries use the immutable artifact ID of the successful preparation', () => {
  const workflow = dependencyArtifactsWorkflow;
  const upload = workflow.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'upload');
  const download = workflow.jobs.publish.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(workflow.jobs.prepare.outputs['artifact-id'], '${{ steps.upload.outputs.artifact-id }}');
  assert.equal(download.with['artifact-ids'], '${{ needs.prepare.outputs.artifact-id }}');
  assert.equal(download.with.name, undefined); assert.match(upload.with.name, /run_id.*run_attempt/);
});
test('standalone tools accept major and exact versions and reject option injection', t => {
  const f = fixture(t); const script = prepareJob.steps.find(step => step.id === 'tools')!.run!;
  for (const version of ['24', '24.21.0']) f.runScript(script, { MISE_ENABLED: 'false', NODE_VERSION: version, PNPM_VERSION: '12.10.1' });
  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /install node@24 pnpm@12.10.1/); assert.match(calls, /install node@24.21.0 pnpm@12.10.1/);
  for (const version of ['--bump', '24; true', '24.x', '24.1']) assert.throws(() => f.runScript(script, { MISE_ENABLED: 'false', NODE_VERSION: version, PNPM_VERSION: '12' }));
  assert.equal(readFileSync(f.log, 'utf8'), calls);
});
