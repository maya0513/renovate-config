import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fixture as artifactFixture, write } from './pnpm-artifacts.ts';

export interface ViteplusOptions {
  workspace?: string;
  exact?: boolean; aligned?: boolean; declarations?: boolean; miseChanges?: boolean;
  duplicate?: boolean; major?: boolean; invalid?: boolean; alias?: boolean;
  instance?: boolean; symlink?: boolean; fail?: boolean; mutate?: boolean;
  unrelated?: boolean; unrelatedVersion?: boolean; unfixed?: boolean; viteChanged?: boolean; invalidCore?: boolean;
}
export function fixture(t: TestContext, options: ViteplusOptions = {}) {
  const env = { HAS_MISE: 'true', HAS_VITEPLUS: 'true', NO_CHANGE: options.miseChanges ? '0' : '1' };
  const bundled = options.major ? '6.0.1' : options.declarations ? '5.0.2' : '5.0.1';
  const initialCoverage = options.aligned ? bundled : '5.0.3';
  const workspace = "packages: ['.']\noverrides:\n  'vite@*': 'npm:@voidzero-dev/vite-plus-core@1.0.0'\n" +
    "  'vitest@*': '5.0.1'\n" + "peerDependencyRules:\n  allowedVersions:\n    vite: '1'\n";
  const f = artifactFixture(t, {
    '.gitignore': 'node_modules/\n.cache/\n',
    'mise.lock': 'old lock\n',
    'package.json': `${JSON.stringify({ type: 'module', devDependencies: { 'vite-plus': '1', '@vitest/coverage-v8': options.major ? '5' : options.exact ? '5.0.3' : options.declarations ? '5' : bundled, ...(options.unrelatedVersion ? { other: '^1.0.0' } : {}) } }, null, 2)}\n`,
    'pnpm-workspace.yaml': options.workspace ?? (options.declarations ? workspace : workspace.replace('vite-plus-core@1.0.0', 'vite-plus-core@1.0.1')),
    'pnpm-lock.yaml': `lockfileVersion: '9.0'\npackages:\n  vitest@${options.declarations ? '5.0.1' : bundled}:\n${options.duplicate ? '  vitest@5.0.9:\n' : ''}  coverage@${initialCoverage}:\n`,
  }, env);
  const pkg = (name: string, data: unknown) => write(f.repo, `node_modules/${name}/package.json`, JSON.stringify(data));
  pkg('vite-plus', { name: 'vite-plus', version: '1.0.0', dependencies: {
    vitest: options.invalid ? '^5.0.1' : bundled, vite: options.invalidCore ? '^1.0.1' : 'npm:@voidzero-dev/vite-plus-core@1.0.1',
  } });
  pkg('vitest', { name: 'vitest', version: options.declarations ? '5.0.1' : bundled });
  pkg('@vitest/coverage-v8', { name: '@vitest/coverage-v8', version: initialCoverage });
  if (options.instance) pkg('@vitest/coverage-v8/node_modules/vitest', { name: 'vitest', version: bundled });
  if (options.symlink) {
    pkg('coverage-old', { name: '@vitest/coverage-v8', version: initialCoverage });
    pkg('coverage-new', { name: '@vitest/coverage-v8', version: bundled });
    rmSync(join(f.repo, 'node_modules/@vitest/coverage-v8'), { recursive: true });
    symlinkSync('../coverage-old', join(f.repo, 'node_modules/@vitest/coverage-v8'));
  }
  pkg('vite', { name: options.alias ? 'vite' : '@voidzero-dev/vite-plus-core', version: options.declarations && !options.aligned ? '1.0.0' : '1.0.1' });
  if (options.unrelatedVersion) {
    pkg('other', { name: 'other', version: '1.0.0', dependencies: { transitive: '^1.0.0' } });
    pkg('transitive', { name: 'transitive', version: '1.0.0' });
  }
  const pnpmLog = join(f.root, 'pnpm-calls');
  writeFileSync(pnpmLog, '');
  writeFileSync(join(f.bin, 'pnpm'), `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(pnpmLog)}, JSON.stringify(args) + '\\n');
if (${Boolean(options.fail)}) process.exit(1);
if (args[0] === 'update' || args.includes('--no-frozen-lockfile')) {
  if (${Boolean(options.viteChanged)}) fs.writeFileSync('node_modules/vite-plus/package.json', JSON.stringify({name:'vite-plus',version:'1.0.1',dependencies:{vitest:${JSON.stringify(bundled)}}}));
  if (${Boolean(options.mutate)}) fs.appendFileSync('package.json', ' ');
  if (${Boolean(options.unrelated)}) fs.writeFileSync('unrelated.txt', 'unexpected');
  if (${Boolean(options.unrelatedVersion)}) fs.writeFileSync('node_modules/transitive/package.json', JSON.stringify({name:'transitive',version:'1.1.0'}));
  if (${Boolean(options.unfixed)}) process.exit(0);
  if (${Boolean(options.symlink)}) {
    fs.unlinkSync('node_modules/@vitest/coverage-v8');
    fs.symlinkSync('../coverage-new', 'node_modules/@vitest/coverage-v8');
  }
  if (${Boolean(options.instance)}) fs.rmSync('node_modules/@vitest/coverage-v8/node_modules', {recursive:true,force:true});
  fs.writeFileSync('node_modules/@vitest/coverage-v8/package.json', JSON.stringify({name:'@vitest/coverage-v8',version:${JSON.stringify(bundled)}}));
  fs.writeFileSync('node_modules/vitest/package.json', JSON.stringify({name:'vitest',version:${JSON.stringify(bundled)}}));
  fs.writeFileSync('node_modules/vite/package.json', JSON.stringify({name:${JSON.stringify(options.alias ? 'vite' : '@voidzero-dev/vite-plus-core')},version:'1.0.1'}));
  fs.writeFileSync('pnpm-lock.yaml', "lockfileVersion: '9.0'\\npackages:\\n  vitest@${bundled}:\\n  coverage@${bundled}:\\n");
}
`, { mode: 0o755 });
  return { ...f, env, pkg, calls: () => readFileSync(pnpmLog, 'utf8') };
}
