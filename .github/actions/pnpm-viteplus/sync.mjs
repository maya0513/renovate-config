import { checkMode, readPreparation } from '../lib/state.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const manifest = path => JSON.parse(readFileSync(path, 'utf8'));
const declarations = ['package.json', 'pnpm-workspace.yaml'];
const readDeclarations = () => declarations.map(path => readFileSync(path, 'utf8'));
const isAllowedArtifact = (path, allowed) => allowed.some(root => resolve(path) === root || resolve(path).startsWith(`${root}/`));
const statePath = join(process.env.RUNNER_TEMP, 'viteplus-state.json');
const require = createRequire(join(process.cwd(), 'package.json'));
const packagePath = (name, from = require) => {
  try { return from.resolve(`${name}/package.json`); }
  catch {
    let directory = dirname(from.resolve(name));
    while (directory !== dirname(directory)) {
      try {
        const path = join(directory, 'package.json');
        if (manifest(path).name === name) return path;
      } catch {}
      directory = dirname(directory);
    }
    throw new Error(`Cannot resolve package manifest: ${name}`);
  }
};
const unrelated = project => {
  const versions = new Map();
  const visited = new Set();
  const visit = (name, from, optional = false) => {
    let path;
    try { path = realpathSync(packagePath(name, from)); }
    catch (error) { if (optional) return; throw error; }
    if (visited.has(path)) return;
    visited.add(path);
    const pkg = manifest(path);
    const found = versions.get(pkg.name) ?? new Set();
    found.add(pkg.version);
    versions.set(pkg.name, found);
    const child = createRequire(path);
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      visit(dep, child, Object.hasOwn(pkg.optionalDependencies ?? {}, dep));
    }
  };
  for (const name of Object.keys({ ...project.dependencies, ...project.devDependencies, ...project.optionalDependencies })) {
    if (name !== 'vite-plus' && name !== '@vitest/coverage-v8') {
      visit(name, require, Object.hasOwn(project.optionalDependencies ?? {}, name));
    }
  }
  return Object.fromEntries([...versions].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, [...values].sort()]));
};

function synchronizeOverrides(workspace, overrides) {
  // Only edit plain scalar overrides in a block mapping. Refuse anchors,
  // flow mappings and ambiguous selectors instead of rewriting other YAML.
  const lines = workspace.split('\n');
  const roots = lines.map((line, index) => /^overrides:\s*(?:#.*)?$/.test(line) ? index : -1).filter(index => index >= 0);
  assert.equal(roots.length, 1, 'pnpm-workspace.yaml needs a plain overrides block');
  const start = roots[0];
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s|^#/.test(lines[end]))) end++;
  for (const [name, value] of Object.entries(overrides)) {
    const pattern = new RegExp(`^( +)(?:'(${name}(?:@\\*)?)'|"(${name}(?:@\\*)?)"|(${name}(?:@\\*)?)):\\s*(.*?)\\s*$`);
    const matches = [];
    for (let i = start + 1; i < end; i++) {
      const match = pattern.exec(lines[i]);
      if (match) matches.push({ index: i, match });
    }
    assert(matches.length <= 1, `Ambiguous ${name} overrides`);
    if (matches.length === 1) {
      const { index, match } = matches[0];
      assert.match(match[5], /^(?:'[^']*'|"[^"\\]*"|[^\s{}\[\]&*!#]+)(?:\s+#.*)?$/, `Unsupported ${name} override scalar`);
      const previous = match[5].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
      if (previous !== value) lines[index] = `${match[1]}${JSON.stringify(match[2] ?? match[3] ?? match[4])}: ${JSON.stringify(value)}`;
    } else {
      const indent = /^ +/.exec(lines.slice(start + 1, end).find(line => /^ +\S/.test(line)) ?? '')?.[0] ?? '  ';
      lines.splice(end++, 0, `${indent}${JSON.stringify(`${name}@*`)}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

const lockedVitestVersions = () => {
  const versions = new Set();
  // pnpm 12 can write a separate settings document. Inspect only
  // the final graph document, excluding override selectors.
  const lock = readFileSync('pnpm-lock.yaml', 'utf8').split(/^---[ \t]*\r?$/m).at(-1);
  let section = '';
  for (const line of lock.split('\n')) {
    if (/^[^\s#]/.test(line)) section = /^([A-Za-z]+):/.exec(line)?.[1] ?? '';
    if (section !== 'packages' && section !== 'snapshots') continue;
    const match = /^ {2}['"]?vitest@([^(:\n'"]+)/.exec(line);
    if (match) versions.add(match[1]);
  }
  return [...versions];
};

// Always verify in a fresh process: pnpm can switch node_modules symlinks.
const graph = (state) => {
  const vpPath = packagePath('vite-plus');
  const vp = manifest(vpPath);
  assert.equal(vp.version, state.version, 'Synchronization must not update Vite+');
  assert.equal(vp.dependencies?.vitest, state.bundled, 'Bundled Vitest changed during synchronization');
  const fromRunner = createRequire(vpPath);
  const coveragePath = packagePath('@vitest/coverage-v8');
  const runnerPath = packagePath('vitest', fromRunner);
  const fromCoverage = createRequire(coveragePath);
  assert.deepEqual(lockedVitestVersions(), [state.bundled], 'The lockfile must resolve a single Vitest version');
  assert.equal(manifest(coveragePath).version, state.bundled, 'Coverage and bundled Vitest differ');
  assert.equal(manifest(runnerPath).version, state.bundled, 'The runner differs from bundled Vitest');
  assert.equal(realpathSync(packagePath('vitest', fromCoverage)), realpathSync(runnerPath), 'Multiple Vitest instances are resolved');
  const vite = manifest(packagePath('vite', fromRunner));
  assert.equal(vite.name, '@voidzero-dev/vite-plus-core', 'The Vite alias does not match');
  if (state.core) assert.equal(vite.version, state.core, 'The Vite core differs from bundled Vite');
  assert.deepEqual(unrelated(manifest('package.json')), state.unrelated, 'Unrelated dependency versions changed');
};

function verify() {
  const state = manifest(statePath);
  assert.deepEqual(readDeclarations(), state.declarations, 'Post-update task changed synchronized declarations');
  graph(state);
}

// Use identical safeguards during synchronization and final validation.
const pnpm = (...args) => execFileSync('pnpm', [
  ...args, '--ignore-scripts', '--ignore-pnpmfile',
  '--pm-on-fail=error',
], { stdio: 'inherit' });

function synchronize() {
  const preceding = process.env.PREPARATION_STATE ? readPreparation(process.env.PREPARATION_STATE) : undefined;
  const explicit = process.env.VERIFY_ONLY;
  const mode = checkMode(explicit || preceding?.verifyOnly || 'true');
  assert(!preceding || mode === preceding.verifyOnly, 'Explicit verify-only contradicts preparation state');
  process.env.VERIFY_ONLY = mode;
  const allowed = preceding?.preparedPaths
    ? readFileSync(preceding.preparedPaths, 'utf8').split('\0').filter(Boolean).map(path => resolve(path)) : [];
  const dirty = execFileSync('git', ['diff', '--name-only', '-z'], { encoding: 'utf8' }) +
    execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  assert(dirty.split('\0').filter(Boolean).every(path => isAllowedArtifact(path, allowed)), 'Start from a clean checkout except prepared artifacts');
  assert.equal(git('diff', '--cached', '--name-only'), '', 'Start without staged changes');
  for (const path of [...declarations, 'pnpm-lock.yaml']) {
    assert(lstatSync(path).isFile(), `${path} must be a regular file`);
    assert.equal(git('ls-files', '--', path), path, `${path} must be tracked`);
  }
  const before = readDeclarations();
  const project = JSON.parse(before[0]);
  const coverage = project.devDependencies?.['@vitest/coverage-v8'];
  assert.equal(typeof coverage, 'string', 'Declare @vitest/coverage-v8 in devDependencies');
  assert.match(coverage, /^\d+(?:\.\d+\.\d+)?$/, 'Coverage must use a major-only declaration or an exact stable version');
  pnpm('install', '--frozen-lockfile');
  const vp = manifest(packagePath('vite-plus'));
  const bundled = vp.dependencies?.vitest;
  assert.equal(typeof bundled, 'string', 'Vite+ must declare its bundled Vitest');
  assert.match(bundled, /^\d+\.\d+\.\d+$/, 'Bundled Vitest must be an exact stable version');
  assert.equal(bundled.split('.')[0], coverage.split('.')[0], 'Vite+ changed its bundled Vitest major; review compatibility before updating');
  const state = {
    component: 'pnpm-viteplus', base: git('rev-parse', 'HEAD'), root: git('rev-parse', '--show-toplevel'),
    verifyOnly: process.env.VERIFY_ONLY, version: vp.version, bundled, unrelated: unrelated(project),
  };

  const alias = vp.dependencies?.vite;
  assert.equal(typeof alias, 'string', 'Vite+ must declare its bundled Vite alias');
  assert.match(alias, /^npm:@voidzero-dev\/vite-plus-core@\d+\.\d+\.\d+$/, 'Bundled Vite must be an exact stable alias');
  state.core = alias.split('@').at(-1);
  project.devDependencies['@vitest/coverage-v8'] = bundled;
  const workspace = synchronizeOverrides(before[1], { vite: alias, vitest: bundled });
  const expected = [coverage === bundled ? before[0] : `${JSON.stringify(project, null, 2)}\n`, workspace];
  if (process.env.VERIFY_ONLY === 'true') {
    assert.deepEqual(before, expected, 'Vite+ declarations are out of date; regenerate and commit them');
  } else {
    expected.forEach((text, index) => { if (text !== before[index]) writeFileSync(declarations[index], text); });
  }
  state.declarations = readDeclarations();
  writeFileSync(statePath, JSON.stringify(state));
  const verifyGraph = () => spawnSync(process.execPath, [process.argv[1], '--graph'], { encoding: 'utf8' });
  if (process.env.VERIFY_ONLY === 'true') {
    const result = verifyGraph();
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } else if (state.declarations.some((text, index) => text !== before[index])) {
    pnpm('install', '--no-frozen-lockfile');
  } else if (verifyGraph().status !== 0) {
    pnpm('update', `@vitest/coverage-v8@${bundled}`, '--no-save');
  }
  pnpm('install', '--frozen-lockfile');
  const result = verifyGraph();
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.deepEqual(readDeclarations(), state.declarations, 'pnpm changed dependency declarations');
  const modified = git('diff', '--name-only').split('\n').filter(Boolean);
  assert(modified.every(path => [...declarations, 'pnpm-lock.yaml'].includes(path) || isAllowedArtifact(path, allowed)), 'Only dependency artifacts may change');
  assert.equal(git('ls-files', '--others', '--exclude-standard'), '', 'Synchronization created unrelated files');
  git('diff', '--check');
  console.log(`Vite+ ${vp.version}: verified single Vitest / coverage ${bundled}`);
}

switch (process.argv[2]) {
  case '--graph': graph(manifest(statePath)); break;
  case '--verify': verify(); break;
  case undefined: synchronize(); break;
  default: throw new Error(`Unknown synchronization mode: ${process.argv[2]}`);
}
