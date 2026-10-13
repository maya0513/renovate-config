import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixture, git, write } from './helpers/pnpm-artifacts.ts';
import { packageRegistry } from './helpers/package-registry.ts';

interface Tool { version: string; install_path: string; installed: boolean }
const configuration = fileURLToPath(new URL('./fixtures/', import.meta.url));
function tools(name: string): Tool[] {
  const versions: Tool[] = JSON.parse(execFileSync('mise', ['-C', configuration, 'ls', '--current', '--json', name], { encoding: 'utf8' }));
  assert.equal(versions.length, 2, `Declare two ${name} versions in the test mise configuration`);
  assert(versions.every(tool => tool.installed), 'Run mise run test:tools before the transition tests');
  return versions.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
}

for (const viteplus of [false, true]) {
  for (const transition of ['node', 'pnpm', 'node+pnpm', 'pnpm-downgrade'] as const) {
    test(`actual ${transition} executables with ${viteplus ? 'mise + Vite+' : 'mise + pnpm'} produce frozen-verifiable output`, { timeout: 60_000 }, async t => {
      const nodes = tools('node'); const managers = tools('pnpm');
      const previousNode = nodes[0]!;
      const selectedNode = transition.includes('node') ? nodes[1]! : previousNode;
      const previousPnpm = transition === 'pnpm-downgrade' ? managers[1]! : managers[0]!;
      const selectedPnpm = transition === 'node' ? previousPnpm : transition === 'pnpm-downgrade' ? managers[0]! : managers[1]!;
      const f = fixture(t, { '.gitignore': 'node_modules/\n', 'mise.lock': 'initial lock\n' }, { HAS_VITEPLUS: String(viteplus) });
      const registry = await packageRegistry(t, f.root, managers.map(tool => tool.version));
      const runtimeEnv = (node: Tool, manager: Tool) => ({
        ...process.env, ...registry.env, PATH: `${node.install_path}/bin:${manager.install_path}:${process.env.PATH}`,
      });
      const install = (node: Tool, manager: Tool, ...args: string[]) => execFileSync(join(manager.install_path, 'pnpm'), [
        'install', ...args, '--ignore-scripts', '--ignore-pnpmfile', '--pm-on-fail=error',
      ], { cwd: f.repo, env: runtimeEnv(node, manager), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const project = {
        name: 'real-tool-transition', private: true,
        packageManager: `pnpm@${previousPnpm.version}`, engines: { node: previousNode.version },
        devDependencies: { ordinary: '^1.0.0', ...(viteplus ? { 'vite-plus': '1.0.0', '@vitest/coverage-v8': '5.0.1' } : {}) },
      };
      write(f.repo, 'package.json', JSON.stringify(project, null, 2) + '\n');
      write(f.repo, 'pnpm-workspace.yaml', 'pmOnFail: error\n' + (viteplus ? 'overrides:\n  vite: npm:@voidzero-dev/vite-plus-core@1.0.0\n  vitest: 5.0.1\n' : ''));
      install(previousNode, previousPnpm, '--no-frozen-lockfile');
      git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'baseline with previous executables');
      project.packageManager = `pnpm@${selectedPnpm.version}` + (!viteplus && transition === 'node' ? `+sha512.${'a'.repeat(128)}` : ''); project.engines.node = selectedNode.version;
      if (viteplus && transition !== 'node') project.devDependencies['vite-plus'] = '1.0.1';
      write(f.repo, 'package.json', JSON.stringify(project, null, 2) + '\n');
      write(f.repo, 'mise.toml', `[tools]\nnode = "${selectedNode.version}"\npnpm = "${selectedPnpm.version}"\n`);
      if (selectedPnpm !== previousPnpm) {
        assert.throws(() => install(selectedNode, selectedPnpm, '--frozen-lockfile', '--offline'), error => {
          assert(error instanceof Error && 'stderr' in error);
          assert.match(String(error.stderr), /ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE/);
          return true;
        });
        // Renovate's retained native npm artifact generation is responsible for
        // this phase. The companion actions never repair stale manager metadata.
        install(selectedNode, selectedPnpm, '--lockfile-only', '--no-frozen-lockfile');
      }
      git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', `selected ${transition}`); git(f.repo, 'push');
      rmSync(join(f.bin, 'pnpm')); symlinkSync(join(selectedPnpm.install_path, 'pnpm'), join(f.bin, 'pnpm'));
      const selected = { ...registry.env, TEST_NODE_HOME: selectedNode.install_path, TEST_PNPM_VERSION: selectedPnpm.version };
      f.update(selected); f.run('push', selected);
      assert.equal(f.runScript('node --version', selected).trim(), `v${selectedNode.version}`);
      assert.equal(f.runScript('pnpm --version', selected).trim(), selectedPnpm.version);
      f.update({ ...selected, VERIFY_ONLY: 'true', NO_CHANGE: '1' });
      assert.equal(f.outputs().changed, 'false');
      assert.equal(JSON.parse(readFileSync(join(f.repo, 'package.json'), 'utf8')).packageManager, project.packageManager);
      install(selectedNode, selectedPnpm, '--frozen-lockfile', '--offline');
      assert.equal(readFileSync(join(f.repo, 'node_modules/ordinary/package.json'), 'utf8').includes('"1.0.0"'), true);
      if (viteplus) {
        const coverage = JSON.parse(readFileSync(join(f.repo, 'node_modules/@vitest/coverage-v8/package.json'), 'utf8'));
        assert.equal(coverage.version, transition === 'node' ? '5.0.1' : '5.0.2');
      }
    });
  }
}
