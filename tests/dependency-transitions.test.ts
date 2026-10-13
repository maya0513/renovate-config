import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseAllDocuments } from 'yaml';
import { fixture, git, write } from './helpers/pnpm-artifacts.ts';
import { packageRegistry } from './helpers/package-registry.ts';

for (const transition of ['node', 'pnpm', 'viteplus', 'node+viteplus', 'pnpm+viteplus', 'npm', 'maintenance'] as const) {
  test(`real pnpm ${transition}${transition.includes('pnpm') ? ' (simulated stale manager metadata)' : ''} transition survives artifact generation and frozen verification`, { timeout: 60_000 }, async t => {
    const f = fixture(t, { '.gitignore': 'node_modules/\n', 'mise.lock': 'initial lock\n' }, {
      HAS_VITEPLUS: 'true',
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
    if (transition.includes('viteplus')) project.devDependencies['vite-plus'] = '1.0.1';
    if (transition === 'npm' || transition === 'maintenance') registry.publishOrdinary();
    if (transition === 'npm') project.devDependencies.ordinary = '1.0.1';
    write(f.repo, 'package.json', `${JSON.stringify(project, null, 2)}\n`);

    if (transition.includes('pnpm')) {
      // This simulates stale manager metadata, not a switch between two pnpm
      // binaries. Native artifact generation must fix it before our workflow.
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
    const upgraded = transition.includes('viteplus');
    assert.deepEqual(versions('vitest'), [`vitest@${upgraded ? '5.0.2' : '5.0.1'}`]);
    assert.deepEqual(versions('@vitest/coverage-v8'), [`@vitest/coverage-v8@${upgraded ? '5.0.2' : '5.0.1'}`]);
    assert.deepEqual(versions('transitive'), ['transitive@1.0.0']);
    assert.deepEqual(versions('ordinary'), [`ordinary@${transition === 'npm' || transition === 'maintenance' ? '1.0.1' : '1.0.0'}`]);
    assert.equal(git(f.repo, 'diff', '--name-only', initial, 'HEAD').split('\n').every(path =>
      ['mise.toml', 'mise.lock', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'].includes(path)), true);
  });
}

for (const viteplus of [false, true]) {
for (const verifyOnly of [false, true]) {
  for (const duringTask of [false, true]) {
    test(`real pnpm rejects a stale importer ${duringTask ? 'written by the generation task' : 'at final frozen validation'} (viteplus=${viteplus}, verify=${verifyOnly})`, { timeout: 60_000 }, async t => {
      const f = fixture(t, { '.gitignore': 'node_modules/\n', 'mise.lock': 'initial lock\n' }, {
        HAS_VITEPLUS: String(viteplus), NO_CHANGE: '1', VERIFY_ONLY: String(verifyOnly),
      });
      const registry = await packageRegistry(t, f.root);
      const executable = execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim();
      symlinkSync(executable, join(f.bin, 'pnpm'));
      write(f.repo, 'package.json', JSON.stringify({
        name: 'final-validation-fixture', private: true, packageManager: `pnpm@${registry.pnpmVersion}`,
        devDependencies: { 'vite-plus': '1.0.0', '@vitest/coverage-v8': '5.0.1' },
      }) + '\n');
      write(f.repo, 'pnpm-workspace.yaml', 'pmOnFail: error\noverrides:\n  vite: npm:@voidzero-dev/vite-plus-core@1.0.0\n  vitest: 5.0.1\n');
      execFileSync(executable, ['install', '--no-frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error'], {
        cwd: f.repo, env: { ...process.env, ...registry.env }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'initial synchronized graph'); git(f.repo, 'push');
      const candidate = git(f.repo, 'rev-parse', 'HEAD');
      f.run('locks', registry.env); f.run('tools', registry.env); if (viteplus) f.run('sync', registry.env);

      const documents = parseAllDocuments(readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8'));
      documents.at(-1)!.setIn(['importers', '.', 'devDependencies', 'vite-plus', 'specifier'], '999.0.0');
      const invalid = documents.map(document => document.toString()).join('');
      // Package versions and installed manifests remain aligned. Only the final
      // importer's request differs, which the old graph-only check accepted.
      const taskEnv: NodeJS.ProcessEnv = duringTask ? {
        POST_UPDATE_TASK: 'generate', POST_UPDATE_PATHS: 'pnpm-lock.yaml',
        TASK_SCRIPT: 'cp "$TEST_REPO/../invalid-lock.yaml" pnpm-lock.yaml',
      } : {};
      write(duringTask ? f.root : f.repo, duringTask ? 'invalid-lock.yaml' : 'pnpm-lock.yaml', invalid);
      assert.throws(() => f.run('update', { ...registry.env, ...taskEnv }), error => {
        assert(error instanceof Error && 'stdout' in error && 'stderr' in error);
        assert.match(String(error.stdout) + String(error.stderr), duringTask
          ? /Post-update task changed dependency declarations, lockfiles, or sidecars/
          : /ERR_PNPM_OUTDATED_LOCKFILE/);
        return true;
      });
      assert.equal(git(f.repo, 'rev-parse', 'HEAD'), candidate);
      assert.equal(git(f.root, '--git-dir', f.remote, 'rev-parse', 'refs/heads/renovate/test'), candidate);
      assert.equal(readFileSync(join(f.repo, 'pnpm-lock.yaml'), 'utf8'), invalid, 'Validation must not repair the invalid lockfile');
      f.assertNoPayload();
    });
  }
}

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
