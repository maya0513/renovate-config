import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseAllDocuments } from 'yaml';
import { fixture, git, write } from './helpers/dependency-artifacts.ts';
import { packageRegistry } from './helpers/package-registry.ts';

for (const transition of ['node', 'pnpm', 'vite-plus', 'node+vite-plus', 'pnpm+vite-plus', 'npm', 'maintenance'] as const) {
  test(`real pnpm ${transition} transition survives artifact generation and frozen verification`, { timeout: 60_000 }, async t => {
    const f = fixture(t, { '.gitignore': 'node_modules/\n', 'mise.lock': 'initial lock\n' }, {
      SYNC_VITE_PLUS: 'true', SYNC_DECLARATIONS: 'true',
    });
    const registry = await packageRegistry(t, f.root);
    const env = { ...process.env, ...registry.env };
    // Use the installed pnpm, rather than the command stub used in unit tests.
    const executable = execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim();
    symlinkSync(executable, join(f.bin, 'pnpm'));
    const pnpm = (...args: string[]) => execFileSync(executable, [
      ...args, '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error',
    ], { cwd: f.repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const project = {
      name: 'transition-fixture', private: true,
      packageManager: `pnpm@${registry.pnpmVersion}`,
      engines: { node: `${process.versions.node.split('.')[0]}.0.0` },
      devDependencies: { 'vite-plus': '1.0.0', '@vitest/coverage-v8': '5.0.1', ordinary: '^1.0.0' },
    };
    write(f.repo, 'package.json', `${JSON.stringify(project, null, 2)}\n`);
    write(f.repo, 'pnpm-workspace.yaml', "pmOnFail: error\noverrides:\n  vite: npm:@voidzero-dev/vite-plus-core@1.0.0\n  vitest: 5.0.1\n");
    pnpm('install', '--no-frozen-lockfile');
    git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'initial synchronized graph');
    const initial = git(f.repo, 'rev-parse', 'HEAD');
    const before = readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8');

    if (transition.includes('node')) {
      project.engines.node = process.versions.node;
      write(f.repo, 'mise.toml', `[tools]\nnode = "${process.versions.node}"\npnpm = "${registry.pnpmVersion}"\n`);
    }
    if (transition.includes('vite-plus')) project.devDependencies['vite-plus'] = '1.0.1';
    if (transition === 'npm' || transition === 'maintenance') registry.publishOrdinary();
    if (transition === 'npm') project.devDependencies.ordinary = '1.0.1';
    write(f.repo, 'package.json', `${JSON.stringify(project, null, 2)}\n`);

    if (transition.includes('pnpm')) {
      // Renovate has selected the new executable, but skipping its npm artifact
      // phase would leave the old package-manager document in the candidate.
      const documents = parseAllDocuments(before);
      documents[0]!.setIn(['importers', '.', 'packageManagerDependencies', 'pnpm', 'specifier'], '0.0.0');
      documents[0]!.setIn(['importers', '.', 'packageManagerDependencies', 'pnpm', 'version'], '0.0.0');
      write(f.repo, 'pnpm-lock.yaml', documents.map(document => document.toString()).join(''));
      assert.throws(() => pnpm('install', '--frozen-lockfile', '--offline'), error => {
        assert(error instanceof Error && 'stderr' in error);
        assert.match(String(error.stderr), /ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE/);
        return true;
      });
    }
    if (transition !== 'node') {
      // Native npm artifact generation remains responsible for the selected
      // npm updates, including pnpm's separate settings/manager document.
      if (transition === 'maintenance') {
        rmSync(join(f.repo, 'pnpm-lock.yaml'));
        rmSync(join(f.repo, 'node_modules'), { recursive: true });
        rmSync(join(f.root, 'cache'), { recursive: true });
      }
      pnpm('install', '--lockfile-only', '--no-frozen-lockfile');
    } else {
      assert.equal(readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8'), before);
    }
    git(f.repo, 'add', '.'); git(f.repo, 'commit', '--allow-empty', '-m', `selected ${transition} update`);
    git(f.repo, 'push');
    f.update(registry.env);
    f.run('push', registry.env);
    f.update({ ...registry.env, VERIFY_ONLY: 'true', NO_CHANGE: '1' });
    pnpm('install', '--frozen-lockfile', '--offline');
    assert.equal(f.outputs().changed, 'false');
    const lock = parseAllDocuments(readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8')).at(-1)!.toJS();
    const versions = (name: string) => Object.keys(lock.packages).filter(key => key.startsWith(`${name}@`));
    const upgraded = transition.includes('vite-plus');
    assert.deepEqual(versions('vitest'), [`vitest@${upgraded ? '5.0.2' : '5.0.1'}`]);
    assert.deepEqual(versions('@vitest/coverage-v8'), [`@vitest/coverage-v8@${upgraded ? '5.0.2' : '5.0.1'}`]);
    assert.deepEqual(versions('transitive'), ['transitive@1.0.0']);
    assert.deepEqual(versions('ordinary'), [`ordinary@${transition === 'npm' || transition === 'maintenance' ? '1.0.1' : '1.0.0'}`]);
    assert.equal(git(f.repo, 'diff', '--name-only', initial, 'HEAD').split('\n').every(path =>
      ['mise.toml', 'mise.lock', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'].includes(path)), true);
  });
}

test('real pnpm refuses a mismatched declared executable without downloading a replacement', t => {
  const f = fixture(t, { 'package.json': '{"packageManager":"pnpm@0.0.0"}\n' });
  assert.throws(() => execFileSync('pnpm', ['install', '--frozen-lockfile', '--offline', '--pm-on-fail=error'], {
    cwd: f.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }), error => {
    assert(error instanceof Error && 'stderr' in error);
    assert.match(String(error.stderr), /ERR_PNPM_BAD_PM_VERSION/);
    return true;
  });
  f.assertUnpublished();
});
