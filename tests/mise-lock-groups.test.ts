import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture, git, write } from './helpers/pnpm-artifacts.ts';

const groups = [
  { lockfile: 'mise.lock', tools: ['conda:lua'], platforms: ['linux-x64', 'linux-arm64'], verify: 'locked' },
  { lockfile: 'mise.lock', tools: ['node'], platforms: ['linux-x64', 'linux-arm64', 'macos-arm64', 'windows-x64'], verify: 'regenerate' },
];
const environment = { LOCK_GROUPS: JSON.stringify(groups), CONFIG_TOOLS: JSON.stringify(['node', 'conda:lua']) };

test('mixed backends regenerate only their explicitly selected platforms and never bump', t => {
  const f = fixture(t);
  f.update(environment);
  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /lock --platform linux-x64,linux-arm64 conda:lua/);
  assert.match(calls, /lock --platform linux-x64,linux-arm64,macos-arm64,windows-x64 node/);
  assert.doesNotMatch(calls, /--bump/);
  assert.equal(git(f.repo, 'rev-list', '--count', `${f.base}..HEAD`), '1');
});

test('locked verification never resolves Conda again even when fresh resolution would fail', t => {
  const f = fixture(t);
  f.update({
    LOCK_GROUPS: JSON.stringify([groups[0]]), CONFIG_TOOLS: '["conda:lua"]',
    VERIFY_ONLY: 'true', FAIL_LOCK: '1',
  });
  assert.match(readFileSync(f.log, 'utf8'), /install --locked conda:lua/);
  assert.doesNotMatch(readFileSync(f.log, 'utf8'), /lock --platform/);
  f.assertUnpublished();
});

test('mixed verification regenerates ordinary tools and installs the recorded Conda graph', t => {
  const f = fixture(t);
  f.update({ ...environment, VERIFY_ONLY: 'true', NO_CHANGE: '1' });
  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /install --locked conda:lua/);
  assert.doesNotMatch(calls, /lock --platform .* conda:lua/);
  assert.match(calls, /lock --platform .* node/);
});

for (const [name, value] of [
  ['invalid JSON', '{'], ['object instead of array', '{}'],
  ['missing tools', JSON.stringify([{ ...groups[0], tools: [] }])],
  ['missing tool coverage', JSON.stringify([groups[0]])],
  ['duplicate tool', JSON.stringify([...groups, groups[0]])],
  ['unknown tool', JSON.stringify([{ ...groups[0], tools: ['npm:unknown'] }, groups[1]])],
  ['unknown lockfile', JSON.stringify([{ ...groups[0], lockfile: 'other.lock' }])],
  ['parent directory', JSON.stringify([{ ...groups[0], lockfile: '../mise.lock' }])],
  ['absolute path', JSON.stringify([{ ...groups[0], lockfile: '/tmp/mise.lock' }])],
  ['metadata path', JSON.stringify([{ ...groups[0], lockfile: '.git/mise.lock' }])],
  ['unsupported verification', JSON.stringify([{ ...groups[0], verify: 'skip' }])],
  ['option injection', JSON.stringify([{ ...groups[0], tools: ['--bump'] }])],
  ['shell injection', JSON.stringify([{ ...groups[0], platforms: ['linux-x64;true'] }])],
] as const) {
  test(`invalid groups reject ${name} before generating or committing`, t => {
    const f = fixture(t);
    assert.throws(() => f.update({ ...environment, LOCK_GROUPS: value }));
    f.assertUnpublished();
    assert.doesNotMatch(readFileSync(f.log, 'utf8'), /lock --platform/);
  });
}

test('a missing lockfile group cannot silently skip nested tools', t => {
  const f = fixture(t, { 'mise.lock': 'old\n', 'nested/mise.lock': 'old\n' });
  assert.throws(() => f.update(environment));
  f.assertUnpublished();
});

test('an invalid locked Conda graph fails without regeneration', t => {
  const f = fixture(t);
  assert.throws(() => f.update({
    LOCK_GROUPS: JSON.stringify([groups[0]]), CONFIG_TOOLS: '["conda:lua"]',
    VERIFY_ONLY: 'true', FAIL_INSTALL: '1',
  }));
  assert.doesNotMatch(readFileSync(f.log, 'utf8'), /lock --platform/);
});

test('the publisher rejects unrelated files injected into the prepared patch', t => {
  const f = fixture(t);
  f.run('locks');
  f.run('update');
  write(f.repo, 'unrelated.txt', 'injected\n');
  git(f.repo, 'add', 'unrelated.txt');
  const patch = f.runScript('git diff --cached --binary --full-index');
  write(f.runnerTemp, 'pnpm-artifacts/changes.patch', patch);
  assert.throws(() => f.commitPrepared());
  f.assertUnpublished();
});

test('groups select nested and environment lockfiles independently', t => {
  const f = fixture(t, { 'mise.prod.lock': 'old\n', 'nested/mise.lock': 'old\n' });
  f.update({ LOCK_GROUPS: JSON.stringify(['mise.prod.lock', 'nested/mise.lock'].map(lockfile => ({
    lockfile, tools: ['node'], platforms: ['linux-x64'], verify: 'regenerate',
  }))) });
  assert.match(readFileSync(f.log, 'utf8'), /\|prod\|1\|lock --platform linux-x64 node/);
  assert.match(readFileSync(f.log, 'utf8'), /nested\|\|1\|lock --platform linux-x64 node/);
});

test('tracked symlink lockfiles cannot resolve configuration outside the repository', t => {
  const f = fixture(t, {});
  write(f.root, 'outside.lock', 'outside\n');
  symlinkSync(join(f.root, 'outside.lock'), join(f.repo, 'mise.lock'));
  git(f.repo, 'add', 'mise.lock'); git(f.repo, 'commit', '-m', 'symlink input');
  assert.throws(() => f.update());
  assert.equal(readFileSync(f.log, 'utf8'), '');
});

test('the publisher cannot hide an unrelated deletion inside an allowed rename', t => {
  const f = fixture(t, { 'mise.lock': 'old\n', 'unrelated.txt': 'rename this unchanged\n' });
  f.run('locks'); f.run('update');
  git(f.repo, 'mv', 'unrelated.txt', 'generated.txt');
  const patch = f.runScript('git diff --cached --binary --full-index');
  write(f.runnerTemp, 'pnpm-artifacts/changes.patch', patch);
  assert.throws(() => f.commitPrepared({ POST_UPDATE_PATHS: 'generated.txt' }));
  f.assertUnpublished();
});
