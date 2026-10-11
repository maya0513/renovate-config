import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { fixture, git, miseLockJob, write } from './helpers/mise-lock.ts';

test('only the real Renovate sender on a Renovate push can regenerate locks', () => {
  const allowed = (eventName: string, senderId: number, ref: string, login = 'renovate[bot]', verifyOnly = false): boolean => runInNewContext(miseLockJob.if, {
    inputs: { 'verify-only': verifyOnly },
    github: { event_name: eventName, event: { sender: { id: senderId, login } }, ref },
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  }, { timeout: 1000 });
  assert.equal(allowed('push', 29139614, 'refs/heads/renovate/npm-non-major'), true);
  assert.equal(allowed('push', 123, 'refs/heads/renovate/npm-non-major'), false);
  assert.equal(allowed('push', 41898282, 'refs/heads/renovate/npm-non-major', 'github-actions[bot]'), false);
  assert.equal(allowed('push', 29139614, 'refs/heads/main'), false);
  assert.equal(allowed('pull_request', 29139614, 'refs/heads/renovate/test'), false);
  assert.equal(allowed('pull_request', 123, 'refs/pull/1/merge', 'human', true), true);
  assert.equal(allowed('push', 41898282, 'refs/heads/renovate/test', 'github-actions[bot]', true), true);
  assert.equal(allowed('push', 123, 'refs/heads/main', 'human', true), true);
  assert.equal(allowed('workflow_dispatch', 123, 'refs/heads/main', 'human', true), true);
});

test('verification is called on every CI event without App credentials and cannot push', () => {
  const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  const verification = ci.jobs['dependency-artifacts'];
  assert.equal(verification.uses, '$/.github/workflows/mise-lock.yml');
  assert.deepEqual(verification.with, { 'verify-only': true });
  assert.equal(verification.if, undefined);
  assert.equal(verification.secrets, undefined);
  const workflow = parse(readFileSync(new URL('../.github/workflows/mise-lock.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.on.workflow_call.inputs['verify-only'].default, false);
  assert.equal(workflow.on.workflow_call.inputs['app-client-id'].required, false);
  assert.equal(workflow.on.workflow_call.secrets['app-private-key'].required, false);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const id of ['credentials', 'app-token', 'push']) {
    const step = miseLockJob.steps.find(step => step.id === id)!;
    const expression = step.if!.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    for (const verifyOnly of [false, true]) {
      assert.equal(runInNewContext(expression, {
        inputs: { 'verify-only': verifyOnly }, steps: { update: { outputs: { changed: 'true' } } },
      }), !verifyOnly, `${id}: verify-only=${verifyOnly}`);
    }
  }
});

test('update mode rejects either missing App credential before regeneration', t => {
  const f = fixture(t);
  for (const [client, key] of [['', ''], ['client', ''], ['', 'private-key']]) {
    assert.throws(() => f.run('credentials', { APP_CLIENT_ID: client, APP_PRIVATE_KEY: key }));
  }
  f.run('credentials', { APP_CLIENT_ID: 'client', APP_PRIVATE_KEY: 'private-key' });
  assert.equal(readFileSync(f.log, 'utf8'), '');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
});

test('unchanged verification succeeds without committing or changing the remote', t => {
  const f = fixture(t);
  f.update({ VERIFY_ONLY: 'true', NO_CHANGE: '1', TASK_NO_CHANGE: '1', POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs' });
  assert.equal(f.outputs().changed, 'false');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), f.base);
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
  assert.match(readFileSync(f.log, 'utf8'), /\|0\|run -- generate/);
});

for (const [description, files, overrides] of [
  ['changed lockfile', { 'mise.lock': 'old\n' }, {}],
  ['new sidecar', { 'mise.lock': 'old\n' }, { SIDECARS: '1', LOCK_NO_CHANGE: '1' }],
  ['removed sidecar', { 'mise.lock': 'old\n', '.mise/locks/old/package.lock': 'old graph\n' }, { REMOVE_SIDECARS: '1', LOCK_NO_CHANGE: '1' }],
  ['changed sidecar', { 'mise.lock': 'old\n', '.mise/locks/new/package.lock': 'old graph\n' }, { SIDECARS: '1', LOCK_NO_CHANGE: '1' }],
  ['generated files', { 'mise.lock': 'old\n', 'generated docs/reference.txt': 'old\n', 'generated docs/removed.txt': 'old\n' }, { NO_CHANGE: '1', POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs', STAGE_UNRELATED: '1' }],
] satisfies [string, Record<string, string>, NodeJS.ProcessEnv][]) {
  test(`verification rejects ${description} without committing or pushing`, t => {
    const f = fixture(t, files);
    assert.throws(() => f.update({ ...overrides, VERIFY_ONLY: 'true' }), error => {
      assert(error instanceof Error && 'stdout' in error);
      assert.match(String(error.stdout), /Dependency artifacts are out of date/);
      return true;
    });
    assert.notEqual(f.outputs().changed, 'true');
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
    assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), f.base);
    if (description !== 'changed lockfile') assert(!git(f.repo, 'diff', '--cached', '--name-only').split('\n').includes('mise.lock'));
    assert(!git(f.repo, 'diff', '--cached', '--name-only').includes('unrelated.txt'));
  });
}

test('a repository without tracked lockfiles needs no commit or mise command', (t) => {
  const f = fixture(t, {});
  f.update({ POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs' });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(f.outputs().changed, 'false');
  assert.equal(readFileSync(f.log, 'utf8'), '');
});

test('unchanged lockfiles do not create an empty commit', (t) => {
  const f = fixture(t);
  f.update({ NO_CHANGE: '1' });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(f.outputs().changed, 'false');
});

test('untracked lockfiles are not regenerated and do not enable the post-update task', (t) => {
  const f = fixture(t, {});
  write(f.repo, 'mise.lock', 'untracked lock\n');
  f.update({ POST_UPDATE_TASK: 'generate' });
  assert.equal(readFileSync(f.log, 'utf8'), '');
  assert.equal(readFileSync(join(f.repo, 'mise.lock'), 'utf8'), 'untracked lock\n');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
});

test('nested, local, and environment lockfiles select the corresponding mise config', (t) => {
  const locks = ['mise.lock', 'mise.local.lock', 'mise.prod.lock', 'mise.prod.local.lock', 'packages/with space/mise.lock'];
  const f = fixture(t, Object.fromEntries(locks.map((path) => [path, 'old\n'])));
  f.update();
  const calls = readFileSync(f.log, 'utf8').split('\n').filter((line) => line.endsWith('|lock') || line.endsWith('|lock --local'));
  assert.equal(calls.length, locks.length);
  assert(calls.some((line) => line.endsWith('||1|lock')));
  assert(calls.some((line) => line.endsWith('||1|lock --local')));
  assert(calls.some((line) => line.endsWith('|prod|1|lock')));
  assert(calls.some((line) => line.endsWith('|prod|1|lock --local')));
  assert(calls.some((line) => line.includes('/packages/with space|')));
  for (const path of locks) assert.match(readFileSync(join(f.repo, path), 'utf8'), /^updated /);
  assert.equal(git(f.repo, 'log', '-1', '--format=%ae'), '41898282+github-actions[bot]@users.noreply.github.com');
  assert.equal(f.outputs().changed, 'true');
});

test('new and removed sidecars are committed, while unrelated files stay outside the commit', (t) => {
  const f = fixture(t, { 'mise.lock': 'old\n', '.mise/locks/old/package.lock': 'old native lock\n' });
  f.update({ SIDECARS: '1', UNRELATED: '1' });
  const changed = git(f.repo, 'diff', '--name-status', f.base, 'HEAD');
  assert.match(changed, /A\s+\.mise\/locks\/new\/package.lock/);
  assert.match(changed, /D\s+\.mise\/locks\/old\/package.lock/);
  assert.match(changed, /M\s+mise.lock/);
  assert.doesNotMatch(changed, /unrelated.txt/);
  assert.match(git(f.repo, 'status', '--porcelain'), /\?\? unrelated.txt/);
});

test('sidecars follow root, nested, .mise, and .config lockfile layouts', (t) => {
  const layouts = [
    ['mise.lock', '.mise/locks'],
    ['packages/nested/mise.lock', 'packages/nested/.mise/locks'],
    ['packages/hidden/.mise/mise.lock', 'packages/hidden/.mise/locks'],
    ['packages/config/.config/mise.lock', 'packages/config/.config/mise/locks'],
    ['packages/config-dir/.config/mise/mise.lock', 'packages/config-dir/.config/mise/locks'],
  ];
  const files: Record<string, string> = {};
  for (const [lock, sidecars] of layouts) {
    assert(lock && sidecars);
    files[lock] = 'old lock\n';
    files[`${sidecars}/old/package.lock`] = 'old sidecar\n';
  }
  const f = fixture(t, files);
  f.update({ SIDECARS: '1' });
  const changes = git(f.repo, 'diff', '--name-status', f.base, 'HEAD').split('\n');
  for (const [lock, sidecars] of layouts) {
    assert(changes.includes(`M\t${lock}`));
    assert(changes.includes(`A\t${sidecars}/new/package.lock`));
    assert(changes.includes(`D\t${sidecars}/old/package.lock`));
  }
});

test('removing the entire sidecar directory stages its tracked deletions', (t) => {
  const f = fixture(t, { 'mise.lock': 'old\n', '.mise/locks/old/package.lock': 'old native lock\n' });
  f.update({ REMOVE_SIDECARS: '1' });
  assert.match(git(f.repo, 'diff', '--name-status', f.base, 'HEAD'), /D\s+\.mise\/locks\/old\/package.lock/);
});

test('environment lockfiles stage only their referenced sidecars', (t) => {
  const f = fixture(t, {
    'mise.prod.lock': 'old environment lock\n',
    '.mise/locks/mise.prod/old/package.lock': 'old environment graph\n',
    '.mise/locks/unrelated/package.lock': 'unrelated base graph\n',
  });
  write(f.repo, 'mise.lock', 'untracked base lock\n');
  f.update({ SIDECARS: '1', UNRELATED_SIDECAR: '1' });
  const changed = git(f.repo, 'diff', '--name-status', f.base, 'HEAD');
  assert.match(changed, /A\s+\.mise\/locks\/mise.prod\/new\/package.lock/);
  assert.match(changed, /D\s+\.mise\/locks\/mise.prod\/old\/package.lock/);
  assert.doesNotMatch(changed, /unrelated/);
  assert.equal(git(f.repo, 'show', 'HEAD:.mise/locks/unrelated/package.lock'), 'unrelated base graph');
  assert.match(git(f.repo, 'diff', '--name-only'), /\.mise\/locks\/unrelated\/package.lock/);
});

test('post-update artifacts can create a commit when lockfiles are unchanged', (t) => {
  const f = fixture(t, {
    'mise.lock': 'old lock\n',
    'generated docs/reference.txt': 'old reference\n',
    'generated docs/removed.txt': 'obsolete reference\n',
    'unrelated.txt': 'original unrelated file\n',
  });
  f.update({ NO_CHANGE: '1', POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs', STAGE_UNRELATED: '1' });
  const changes = git(f.repo, 'diff', '--name-status', f.base, 'HEAD');
  assert.match(changes, /A\s+generated docs\/new.txt/);
  assert.match(changes, /D\s+generated docs\/removed.txt/);
  assert.match(changes, /M\s+generated docs\/reference.txt/);
  assert.doesNotMatch(changes, /mise.lock|unrelated.txt/);
  assert.equal(git(f.repo, 'show', 'HEAD:unrelated.txt'), 'original unrelated file');
  assert.equal(git(f.repo, 'diff', '--name-only'), 'unrelated.txt');
  assert.equal(git(f.repo, 'diff', '--cached', '--name-only'), '');
});

test('the post-update task runs once at the root with a literal name after locked installation', (t) => {
  const f = fixture(t, { 'mise.lock': 'old\n', 'nested/mise.lock': 'old\n' });
  const task = 'generate docs; echo must-not-execute';
  f.update({ POST_UPDATE_TASK: task, POST_UPDATE_PATHS: 'generated docs' });
  const calls = readFileSync(f.log, 'utf8').trim().split('\n').filter((line) => !line.includes('--sidecars'));
  assert.equal(calls.filter((line) => line.includes('|run ')).length, 1);
  const taskIndex = calls.findIndex((line) => line.includes('|run '));
  assert.deepEqual(calls.slice(taskIndex - 1, taskIndex + 1), [
    `${f.repo}||1|install --locked`,
    `${f.repo}||0|run -- ${task}`,
  ]);
  assert(calls.filter((_, index) => index !== taskIndex).every((line) => line.includes('|1|')));
  assert.deepEqual(calls.slice(taskIndex + 1), [
    `${f.repo}||1|install --locked --dry-run`,
    `${f.repo}/nested||1|install --locked --dry-run`,
  ]);
});

test('an unchanged post-update task does not create an empty commit', (t) => {
  const f = fixture(t);
  f.update({ NO_CHANGE: '1', TASK_NO_CHANGE: '1', POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'generated docs' });
  assert.match(readFileSync(f.log, 'utf8'), /\|0\|run -- generate/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(f.outputs().changed, 'false');
});

test('tracked locks are staged after the post-update task has finished', (t) => {
  const f = fixture(t);
  f.update({ NO_CHANGE: '1', TASK_CHANGES_LOCK: '1', POST_UPDATE_TASK: 'generate' });
  assert.match(git(f.repo, 'show', 'HEAD:mise.lock'), /task update$/);
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'mise.lock');
});

for (const path of ['mise.lock', 'nested/mise.lock', 'mise.prod.lock', '.mise/locks/new/package.lock']) {
  test(`post-update corruption of ${path} stops before committing`, (t) => {
    const f = fixture(t, { 'mise.lock': 'old\n', 'nested/mise.lock': 'old\n', 'mise.prod.lock': 'old\n' });
    assert.throws(() => f.update({ SIDECARS: '1', POST_UPDATE_TASK: 'generate', TASK_INVALID_PATH: path }));
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
    assert.notEqual(f.outputs().changed, 'true');
  });
}

test('post-update paths accept separate files, deletions, CRLF, blank lines, and missing outputs', (t) => {
  const f = fixture(t, { 'mise.lock': 'old\n', 'generated docs/removed.txt': 'obsolete\n' });
  f.update({
    POST_UPDATE_TASK: 'generate',
    POST_UPDATE_PATHS: './generated docs/new.txt\r\n\n generated-file-that-does-not-exist\ngenerated docs/removed.txt',
  });
  const changes = git(f.repo, 'diff', '--name-status', f.base, 'HEAD');
  assert.match(changes, /A\s+generated docs\/new.txt/);
  assert.match(changes, /D\s+generated docs\/removed.txt/);
  assert.doesNotMatch(changes, /reference.txt|unrelated.txt/);
});

test('post-update paths are literal filenames rather than Git pathspec patterns', (t) => {
  const f = fixture(t, { 'mise.lock': 'old\n', 'artifacts[1].txt': 'old literal\n', 'artifacts1.txt': 'old unrelated\n' });
  f.update({ POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'artifacts[1].txt', LITERAL_PATHS: '1' });
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'artifacts[1].txt\nmise.lock');
  assert.equal(git(f.repo, 'show', 'HEAD:artifacts1.txt'), 'old unrelated');
});

test('post-update paths cannot select the repository root, metadata, or parent directories', (t) => {
  for (const path of ['.', './', '..', '../outside', 'generated docs/../../outside', '/tmp', '.git/config']) {
    const f = fixture(t);
    assert.throws(() => f.update({ POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: path }), path);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  }
});

for (const failure of ['FAIL_INSPECT', 'FAIL_LOCK', 'FAIL_VALIDATE', 'FAIL_INSTALL', 'FAIL_TASK']) {
  test(`${failure} stops before committing or declaring a successful update`, (t) => {
    const f = fixture(t);
    assert.throws(() => f.update({ [failure]: '1', POST_UPDATE_TASK: 'generate' }));
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
    assert.notEqual(f.outputs().changed, 'true');
  });
}

test('an unchanged remote branch accepts the generated commit', (t) => {
  const f = fixture(t);
  f.update();
  f.run('push');
  assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), git(f.repo, 'rev-parse', 'HEAD'));
});

test('a concurrently updated remote branch is never overwritten', (t) => {
  const f = fixture(t);
  f.update();
  const other = join(f.root, 'other');
  git(f.root, 'clone', '--branch', 'renovate/test', f.remote, other);
  git(other, 'config', 'user.name', 'Concurrent updater');
  git(other, 'config', 'user.email', 'other@example.invalid');
  write(other, 'new-config.txt', 'newer dependency config\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'concurrent update');
  git(other, 'push', 'origin', 'renovate/test');
  const newer = git(other, 'rev-parse', 'HEAD');
  assert.throws(() => f.run('push'));
  assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), newer);
});

test('a deleted Renovate branch is never recreated by the lockfile workflow', (t) => {
  const f = fixture(t);
  f.update();
  git(f.root, '--git-dir', f.remote, 'update-ref', '-d', 'refs/heads/renovate/test');
  assert.throws(() => f.run('push'));
  assert.throws(() => git(f.root, '--git-dir', f.remote, 'rev-parse', '--verify', 'refs/heads/renovate/test'));
});
