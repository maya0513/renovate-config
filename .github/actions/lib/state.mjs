import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export function checkMode(mode) {
  assert(['true', 'false'].includes(mode), 'verify-only must be true or false');
  try {
    execFileSync('bash', [fileURLToPath(new URL('./mode.sh', import.meta.url))], {
      env: { ...process.env, VERIFY_ONLY: mode }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) { throw new Error(String(error.stdout || error.stderr || error.message).trim()); }
  return mode;
}
export function temporaryFile(path) {
  try {
    assert(typeof path === 'string' && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
      realpathSync(path).startsWith(realpathSync(process.env.RUNNER_TEMP) + sep));
  } catch { throw new Error('Invalid or missing preparation state'); }
  return path;
}
export function readPreparation(path) {
  const state = JSON.parse(readFileSync(temporaryFile(path), 'utf8'));
  assert(state.base === git('rev-parse', 'HEAD') && state.root === git('rev-parse', '--show-toplevel') &&
    ['true', 'false'].includes(state.verifyOnly), 'Preparation components must use the same commit, repository and verify-only mode');
  checkMode(state.verifyOnly);
  if (state.preparedPaths) {
    const entries = readFileSync(temporaryFile(state.preparedPaths), 'utf8').split('\0').filter(Boolean);
    assert(entries.every(path => resolve(path).startsWith(state.root + sep)), 'Prepared paths must stay inside the repository');
  }
  return state;
}
