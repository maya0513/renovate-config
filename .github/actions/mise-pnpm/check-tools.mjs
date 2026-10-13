import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const project = JSON.parse(readFileSync('package.json', 'utf8'));
const manager = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[a-fA-F0-9]+)?$/.exec(project.packageManager ?? '');
assert(manager, 'packageManager must declare pnpm with an exact stable version (optional integrity suffix)');
for (const name of ['node', 'pnpm']) {
  const selected = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, `${name}-tools.json`), 'utf8')).filter(tool => tool.active);
  assert(selected.length === 1 && selected[0].installed && typeof selected[0].version === 'string',
    `mise must select one installed, locked ${name} version`);
  const expected = selected[0].version;
  if (name === 'pnpm') assert.equal(expected, manager[1], 'The locked pnpm version must match packageManager');
  const executable = name === 'node' ? process.execPath : process.env.PNPM_EXECUTABLE;
  const actual = name === 'node' ? process.versions.node : execFileSync(executable, ['--version'], {
    cwd: process.env.RUNNER_TEMP, encoding: 'utf8', env: { ...process.env, pnpm_config_pm_on_fail: 'error' },
  }).trim();
  assert.equal(actual, expected, `The running ${name} version must match the locked version`);
}
