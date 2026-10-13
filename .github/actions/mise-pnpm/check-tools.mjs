import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const project = JSON.parse(readFileSync('package.json', 'utf8'));
const stable = /^\d+\.\d+\.\d+$/;
assert(typeof project.engines?.node === 'string' && stable.test(project.engines.node), 'engines.node must declare an exact stable Node version');
const manager = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[a-fA-F0-9]+)?$/.exec(project.packageManager ?? '');
assert(manager, 'packageManager must declare pnpm with an exact stable version (optional integrity suffix)');
for (const [name, expected] of [['node', project.engines.node], ['pnpm', manager[1]]]) {
  const selected = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, `${name}-tools.json`), 'utf8')).filter(tool => tool.active);
  assert(selected.length === 1 && selected[0].installed && selected[0].requested_version === expected && selected[0].version === expected,
    `mise declaration and locked ${name} version must match package.json (${expected})`);
  const executable = name === 'node' ? process.execPath : process.env.PNPM_EXECUTABLE;
  const expectedPath = join(selected[0].install_path, name === 'node' ? 'bin/node' : 'pnpm');
  assert.equal(realpathSync(executable), realpathSync(expectedPath), `The selected ${name} executable must come from mise`);
  const actual = name === 'node' ? process.versions.node : execFileSync(executable, ['--version'], {
    cwd: process.env.RUNNER_TEMP, encoding: 'utf8', env: { ...process.env, pnpm_config_pm_on_fail: 'error' },
  }).trim();
  assert.equal(actual, expected, `The running ${name} version must match package.json`);
}
