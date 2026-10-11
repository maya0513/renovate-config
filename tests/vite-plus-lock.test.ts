import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

interface Step { id?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { if: string; needs?: string; steps: Step[]; permissions?: Record<string, string>; outputs?: Record<string, string> }
const workflow = parse(readFileSync(new URL('../.github/workflows/vite-plus-lock.yml', import.meta.url), 'utf8')) as {
  permissions: Record<string, string>; jobs: Record<string, Job>;
};
const prepare = workflow.jobs.prepare!;
const publish = workflow.jobs.publish!;
function script(job: Job, id: string): string {
  const run = job.steps.find(step => step.id === id)?.run;
  assert(run, `Missing ${id} script`);
  return run;
}
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' };
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function fixture(t: TestContext, options: Record<string, boolean> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renovate-vite-plus-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  const bin = join(root, 'bin');
  const temp = join(root, 'temp');
  for (const path of [repo, bin, temp]) mkdirSync(path);
  git(root, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'renovate/test');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n.cache/\n');
  write(repo, 'package.json', JSON.stringify({ type: 'module', devDependencies: { 'vite-plus': '1', '@vitest/coverage-v8': '5' } }));
  write(repo, 'pnpm-workspace.yaml', 'overrides:\n  vite: npm:@voidzero-dev/vite-plus-core@1\n');
  write(repo, 'pnpm-lock.yaml', `lockfileVersion: '9.0'\npackages:\n  vitest@5.0.1:\n${options.duplicate ? '  vitest@5.0.2:\n' : ''}  coverage@${options.aligned ? '5.0.1' : '5.0.2'}:\n`);
  const pkg = (name: string, data: unknown) => write(repo, `node_modules/${name}/package.json`, JSON.stringify(data));
  pkg('vite-plus', { name: 'vite-plus', version: '1.0.0', dependencies: { vitest: options.major ? '6.0.1' : options.invalid ? '^5.0.1' : '5.0.1' } });
  pkg('vitest', { name: 'vitest', version: '5.0.1' });
  pkg('@vitest/coverage-v8', { name: '@vitest/coverage-v8', version: options.aligned ? '5.0.1' : '5.0.2' });
  if (options.instance) pkg('@vitest/coverage-v8/node_modules/vitest', { name: 'vitest', version: '5.0.1' });
  if (options.symlink) {
    renameSync(join(repo, 'node_modules/@vitest/coverage-v8'), join(repo, 'node_modules/coverage-old'));
    pkg('coverage-new', { name: '@vitest/coverage-v8', version: '5.0.1' });
    symlinkSync('../coverage-old', join(repo, 'node_modules/@vitest/coverage-v8'));
  }
  pkg('vite', { name: options.alias ? 'vite' : '@voidzero-dev/vite-plus-core', version: '1.0.0' });
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'renovate/test');
  const base = git(repo, 'rev-parse', 'HEAD');
  const log = join(root, 'calls');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args)+'\\n');
if (${Boolean(options.fail)}) process.exit(1);
if (args[0]==='update') {
  if (${Boolean(options.viteChanged)}) fs.writeFileSync('node_modules/vite-plus/package.json', JSON.stringify({name:'vite-plus',version:'1.0.1',dependencies:{vitest:'5.0.1'}}));
  if (${Boolean(options.mutate)}) fs.appendFileSync('package.json',' ');
  if (${Boolean(options.unrelated)}) fs.writeFileSync('unrelated.txt','unexpected');
  if (${Boolean(options.unfixed)}) process.exit(0);
  if (${Boolean(options.symlink)}) {
    fs.unlinkSync('node_modules/@vitest/coverage-v8');
    fs.symlinkSync('../coverage-new','node_modules/@vitest/coverage-v8');
  }
  fs.writeFileSync('node_modules/@vitest/coverage-v8/package.json', JSON.stringify({name:'@vitest/coverage-v8',version:'5.0.1'}));
  fs.writeFileSync('pnpm-lock.yaml', "lockfileVersion: '9.0'\\npackages:\\n  vitest@5.0.1:\\n  coverage@5.0.1:\\n");
}
`, { mode: 0o755 });
  const output = join(root, 'outputs');
  writeFileSync(output, '');
  const env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, GITHUB_SHA: base, BASE_SHA: base, BRANCH: 'renovate/test', TEST_LOG: log };
  const run = (job: Job, id: string, overrides: NodeJS.ProcessEnv = {}) => execFileSync('bash', ['-c', script(job, id)], { cwd: repo, env: { ...env, ...overrides }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, repo, remote, base, temp, run, output: () => readFileSync(output, 'utf8'), calls: () => readFileSync(log, 'utf8') };
}

test('only real Renovate pushes start repair; App pushes and PR events do not loop', () => {
  for (const [event, sender, ref, expected] of [
    ['push', 29139614, 'refs/heads/renovate/test', true],
    ['push', 41898282, 'refs/heads/renovate/test', false],
    ['push', 123, 'refs/heads/renovate/test', false],
    ['push', 29139614, 'refs/heads/main', false],
    ['pull_request', 29139614, 'refs/heads/renovate/test', false],
  ] as const) {
    assert.equal(runInNewContext(prepare.if, { github: { event_name: event, event: { sender: { id: sender } }, ref }, startsWith: (a: string, b: string) => a.startsWith(b) }), expected);
  }
});

test('dependency execution is isolated from App credentials and write permissions', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(prepare.permissions, undefined);
  assert(!JSON.stringify(prepare).includes('app-private-key'));
  assert.equal(publish.needs, 'prepare');
  assert.match(publish.if, /needs\.prepare\.outputs\.changed == 'true'/);
  assert(!JSON.stringify(publish).includes('pnpm install'));
  const token = publish.steps.find(step => step.id === 'app-token')!;
  assert.equal(token.with?.['permission-contents'], 'write');
  assert.equal(token.with?.repositories, '${{ github.event.repository.name }}');
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  }
});

test('publication retries download the artifact from the successful preparation attempt', () => {
  const upload = prepare.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))!;
  const download = publish.steps.find(step => step.uses?.startsWith('actions/download-artifact@'))!;
  const resolve = (template: unknown, context: Record<string, unknown>): string => {
    assert.equal(typeof template, 'string');
    return (template as string).replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression: string) => {
      let value: unknown = context;
      for (const key of expression.split('.')) {
        assert(value !== null && typeof value === 'object' && key in value, `Missing ${expression}`);
        value = (value as Record<string, unknown>)[key];
      }
      return String(value);
    });
  };
  const artifacts = new Map<string, string>();
  for (const attempt of [1, 3]) {
    const github = { run_id: '12345', run_attempt: attempt, sha: 'a'.repeat(40) };
    const name = resolve(upload.with?.name, { github });
    assert(![...artifacts.values()].includes(name), 'Full reruns must upload distinct artifacts');
    const artifactId = String(100 + attempt);
    artifacts.set(artifactId, name);
    assert(upload.id, 'Expose the uploaded artifact through job outputs');
    const steps = { [upload.id]: { outputs: { 'artifact-id': artifactId } } };
    const outputs = Object.fromEntries(Object.entries(prepare.outputs ?? {}).map(([key, value]) => [
      key, resolve(value, { github, steps: { ...steps, sync: { outputs: { changed: 'true' } } } }),
    ]));
    for (const publishAttempt of [attempt, attempt + 1]) {
      const selected = resolve(download.with?.['artifact-ids'], {
        github: { ...github, run_attempt: publishAttempt }, needs: { prepare: { outputs } },
      });
      assert.equal(artifacts.get(selected), name, 'A publication retry must reuse the prepared artifact');
    }
    assert.equal(download.with?.name, undefined, 'An artifact name must not override the selected ID');
  }
});

test('repairs coverage to the locked Vite+ runner and prepares only the lockfile', t => {
  const f = fixture(t);
  f.run(prepare, 'sync');
  assert.match(f.output(), /changed=true/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  assert.equal(git(f.repo, 'diff', '--name-only'), 'pnpm-lock.yaml');
  assert.equal(readFileSync(join(f.temp, 'vite-plus-lock/pnpm-lock.yaml'), 'utf8'), readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8'));
  assert.match(f.calls(), /"update","@vitest\/coverage-v8@5.0.1","--no-save"/);
  const calls = f.calls().trim().split('\n').map(line => JSON.parse(line) as string[]);
  for (const call of calls) {
    assert(call.includes('--ignore-scripts'));
    assert(call.includes('--ignore-pnpmfile'));
  }
  assert(calls.filter(call => call[0] === 'install').every(call => call.includes('--frozen-lockfile')));
});

test('aligned dependencies produce no payload and do not update any package', t => {
  const f = fixture(t, { aligned: true });
  f.run(prepare, 'sync');
  assert.match(f.output(), /changed=false/);
  assert(!f.calls().includes('"update"'));
  assert.equal(git(f.repo, 'diff', '--name-only'), '');
});

test('duplicate runner resolutions are repaired before publication', t => {
  const f = fixture(t, { aligned: true, duplicate: true });
  f.run(prepare, 'sync');
  assert.match(f.output(), /changed=true/);
  assert(!readFileSync(join(f.temp, 'vite-plus-lock/pnpm-lock.yaml'), 'utf8').includes('5.0.2'));
});

test('verification resolves the new pnpm symlink after an update rather than cached old paths', t => {
  const f = fixture(t, { symlink: true });
  f.run(prepare, 'sync');
  assert.match(f.output(), /changed=true/);
});

for (const [option, reason] of [
  ['major', /Vite\+ changed its bundled Vitest major/],
  ['invalid', /Bundled Vitest must be an exact stable version/],
  ['alias', /The Vite alias does not match/],
  ['fail', /Command failed: pnpm install/],
  ['mutate', /Dependency declarations must not change/],
  ['unrelated', /Only pnpm-lock.yaml may change/],
  ['unfixed', /Coverage and bundled Vitest differ/],
  ['instance', /Multiple Vitest instances are resolved/],
  ['viteChanged', /Synchronization must not update Vite\+/],
] as const) {
  test(`${option} fails without declaring a publishable result`, t => {
    const f = fixture(t, { [option]: true });
    assert.throws(() => f.run(prepare, 'sync'), error => {
      assert(error instanceof Error && 'stderr' in error);
      assert.match(String(error.stderr), reason);
      return true;
    });
    assert(!f.output().includes('changed=true'));
    assert(!existsSync(join(f.temp, 'vite-plus-lock/pnpm-lock.yaml')));
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
  });
}

test('publisher commits only the prepared lockfile and pushes with the original lease', t => {
  const f = fixture(t);
  f.run(prepare, 'sync');
  git(f.repo, 'checkout', '--', 'pnpm-lock.yaml');
  f.run(publish, 'commit');
  assert.equal(git(f.repo, 'diff', '--name-only', f.base, 'HEAD'), 'pnpm-lock.yaml');
  assert.equal(git(f.repo, 'log', '-1', '--format=%ae'), '41898282+github-actions[bot]@users.noreply.github.com');
  f.run(publish, 'push');
  assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), git(f.repo, 'rev-parse', 'HEAD'));
});

for (const deleted of [false, true]) {
  test(`${deleted ? 'deleted' : 'advanced'} remote branch is never overwritten`, t => {
    const f = fixture(t);
    f.run(prepare, 'sync');
    git(f.repo, 'checkout', '--', 'pnpm-lock.yaml');
    f.run(publish, 'commit');
    let remoteHead: string | undefined;
    if (deleted) git(f.root, '--git-dir', f.remote, 'update-ref', '-d', 'refs/heads/renovate/test');
    else {
      const other = join(f.root, 'other');
      git(f.root, 'clone', '--branch', 'renovate/test', f.remote, other);
      write(other, 'newer.txt', 'concurrent update');
      git(other, 'add', '.');
      git(other, '-c', 'user.name=Other', '-c', 'user.email=other@example.invalid', 'commit', '-m', 'concurrent');
      git(other, 'push', 'origin', 'renovate/test');
      remoteHead = git(other, 'rev-parse', 'HEAD');
    }
    assert.throws(() => f.run(publish, 'push'));
    if (deleted) assert.throws(() => git(f.root, '--git-dir', f.remote, 'rev-parse', '--verify', 'refs/heads/renovate/test'));
    else assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), remoteHead);
  });
}

test('publisher refuses a checkout that does not match the prepared SHA', t => {
  const f = fixture(t);
  f.run(prepare, 'sync');
  assert.throws(() => f.run(publish, 'commit', { BASE_SHA: '0'.repeat(40) }));
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
});

test('publisher rejects a symbolic link payload without creating a commit', t => {
  const f = fixture(t);
  f.run(prepare, 'sync');
  git(f.repo, 'checkout', '--', 'pnpm-lock.yaml');
  const path = join(f.temp, 'vite-plus-lock/pnpm-lock.yaml');
  rmSync(path);
  execFileSync('ln', ['-s', join(f.repo, 'package.json'), path]);
  assert.throws(() => f.run(publish, 'commit'));
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.base);
});

test('preparation refuses a dirty checkout before running dependencies', t => {
  const f = fixture(t);
  write(f.repo, 'unexpected.txt', 'untracked');
  assert.throws(() => f.run(prepare, 'sync'));
  assert.equal(f.calls(), '');
});
