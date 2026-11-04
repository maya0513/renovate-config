import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, readPreparation, temporaryFile } from '../lib/state.mjs';

const selections = [['mise-pnpm', process.env.MISE_STATE], ['pnpm-viteplus', process.env.VITEPLUS_STATE]].filter(([, path]) => path);
// No preparation state means ordinary pnpm verification only. Generation still
// requires an explicitly selected preparation component and its checked state.
assert(selections.length > 0 || (!process.env.POST_UPDATE_TASK && !process.env.POST_UPDATE_PATHS),
  'Select at least one preparation component before requesting generation or output paths');
const base = git('rev-parse', 'HEAD');
const root = git('rev-parse', '--show-toplevel');
// A missing wire must not silently shrink validation to ordinary pnpm. Records
// for another checkout/commit can coexist in the runner temp directory; never
// overwrite their inventories while checking the current project.
for (const [component, filename, input] of [
  ['mise-pnpm', 'mise-pnpm-state.json', 'mise-state'],
  ['pnpm-viteplus', 'viteplus-state.json', 'viteplus-state'],
]) {
  const path = join(process.env.RUNNER_TEMP, filename);
  if (!existsSync(path)) continue;
  const prepared = JSON.parse(readFileSync(temporaryFile(path), 'utf8'));
  if (prepared.root === root && prepared.base === base) {
    assert(selections.some(([selected]) => selected === component),
      `Pass ${input} to pnpm-outputs: ${component} already prepared this checkout`);
  }
}
const states = selections.map(([component, path]) => {
  const state = readPreparation(path);
  assert.equal(state.component, component, 'Preparation state does not match the selected component');
  return state;
});
assert(states.every(state => state.verifyOnly === states[0].verifyOnly), 'Preparation components must use the same commit, repository and verify-only mode');
const values = { VERIFY_ONLY: states[0]?.verifyOnly ?? 'true', HAS_MISE: String(Boolean(process.env.MISE_STATE)),
  HAS_VITEPLUS: String(Boolean(process.env.VITEPLUS_STATE)), PREPARATION_BASE: base };
appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
appendFileSync(process.env.GITHUB_OUTPUT, `verify-only=${values.VERIFY_ONLY}\n`);
