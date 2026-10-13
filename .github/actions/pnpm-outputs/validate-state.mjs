import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, readPreparation } from '../lib/state.mjs';

const selections = [['mise-pnpm', process.env.MISE_STATE], ['pnpm-viteplus', process.env.VITEPLUS_STATE]].filter(([, path]) => path);
assert(selections.length > 0, 'Select at least one preparation component');
const states = selections.map(([component, path]) => {
  const state = readPreparation(path);
  assert.equal(state.component, component, 'Preparation state does not match the selected component');
  return state;
});
assert(states.every(state => state.verifyOnly === states[0].verifyOnly), 'Preparation components must use the same commit, repository and verify-only mode');
if (!process.env.MISE_STATE) {
  writeFileSync(join(process.env.RUNNER_TEMP, 'mise-lockfiles'), '');
  writeFileSync(join(process.env.RUNNER_TEMP, 'mise-lock-artifacts'), '');
}
const values = { VERIFY_ONLY: states[0].verifyOnly, HAS_MISE: String(Boolean(process.env.MISE_STATE)),
  HAS_VITEPLUS: String(Boolean(process.env.VITEPLUS_STATE)), PREPARATION_BASE: git('rev-parse', 'HEAD') };
appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
appendFileSync(process.env.GITHUB_OUTPUT, `verify-only=${values.VERIFY_ONLY}\n`);
