import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { TestContext } from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  id?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface WorkflowJob {
  if: string;
  env: Record<string, string>;
  steps: WorkflowStep[];
}

export function readWorkflow(name: string) {
  return parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
}

export const pnpmWorkflow = readWorkflow('update');
export const prepareJob = pnpmWorkflow.jobs.prepare as WorkflowJob;
export const publishJob = readWorkflow('publish-pnpm-artifacts').jobs.publish as WorkflowJob;

export function componentSteps(name: string): WorkflowStep[] {
  const directory = new URL(`../../.github/actions/${name}/`, import.meta.url);
  const action = parse(readFileSync(new URL('action.yml', directory), 'utf8'));
  return action.runs.steps.map((step: WorkflowStep) => ({
    ...step,
    run: step.run ? `export ACTION_PATH=${JSON.stringify(directory.pathname)}\n${step.run}` : undefined,
  }));
}

function workflowStep(id: string): WorkflowStep {
  const step = [...componentSteps('mise-pnpm'), ...componentSteps('pnpm-viteplus'), ...componentSteps('pnpm-outputs'), ...publishJob.steps].find(step => step.id === id);
  assert(step, `Workflow step ${id} must exist`);
  return step;
}

const fakeMise = `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s|%s\\n' "$PWD" "\${MISE_ENV:-}" "\${MISE_SAFE:-}" "$*" >> "$TEST_LOG"
lock=mise
if [[ -n "\${MISE_ENV:-}" ]]; then lock+=".$MISE_ENV"; fi
if [[ " $* " == *' --local '* ]]; then lock+=.local; fi
lock+=.lock
if [[ "$1" == where ]]; then
  case "$2" in
    node|node@*) printf '%s\\n' "$TEST_NODE_HOME" ;;
    pnpm|pnpm@*) printf '%s\\n' "$TEST_BIN" ;;
    *) exit 13 ;;
  esac
  exit 0
fi
if [[ "$1" == config ]]; then
  if [[ -n "\${CONFIG_MISE:-}" ]]; then exec "$CONFIG_MISE" "$@"; fi
  config=\"\${lock%.lock}.toml\"
  config_tools=\${CONFIG_TOOLS:-}
  if [[ -z "$config_tools" ]]; then config_tools='["node"]'; fi
  jq -n --arg path "$PWD/$config" --argjson tools "$config_tools" '[{path: $path, tools: $tools}]' > "$RUNNER_TEMP/fake-config.json"
  if [[ -f "$TEST_REPO/mise.local.toml" ]]; then
    jq --arg path "$TEST_REPO/mise.local.toml" '. + [{path: $path, tools: []}]' "$RUNNER_TEMP/fake-config.json"
  else cat "$RUNNER_TEMP/fake-config.json"; fi
  exit 0
fi
case "$PWD" in
  */.mise|*/.config/mise) sidecars=locks ;;
  */.config) sidecars=mise/locks ;;
  *) sidecars=.mise/locks ;;
esac
if [[ "$lock" != mise.lock ]]; then sidecars+="/\${lock%.lock}"; fi
if [[ "$*" == *--sidecars* ]]; then
  if [[ "\${FAIL_INSPECT:-0}" == 1 ]]; then exit 12; fi
  graphs=()
  for graph in old new; do
    if [[ -d "$sidecars/$graph" ]]; then graphs+=("$sidecars/$graph"); fi
  done
  jq -n --arg lock "$lock" --arg root "$sidecars" --args \\
    '[{lockfile: $lock, root: $root, sidecars: ($ARGS.positional | map({path: .}))}]
      + (if $ENV.UNRELATED_SIDECAR == "1" then
          [{lockfile: "mise.lock", sidecars: [{path: ".mise/locks/unrelated"}]}]
        else [] end)' "\${graphs[@]}"
  exit 0
fi
if [[ "$1" == install ]]; then
  if [[ "$*" == *--dry-run* ]]; then
    if [[ "\${FAIL_VALIDATE:-0}" == 1 ]]; then exit 9; fi
    for file in mise*.lock "$sidecars"/*/package.lock; do
      if [[ -f "$file" && "$(<"$file")" == invalid* ]]; then exit 9; fi
    done
  elif [[ "\${FAIL_INSTALL:-0}" == 1 ]]; then exit 11; fi
  exit 0
fi
if [[ "$1" == run ]]; then
  [[ "\${MISE_SAFE:-}" == 0 ]]
  [[ "$#" == 3 && "$2" == -- && "$3" == "$POST_UPDATE_TASK" ]]
  if [[ "\${FAIL_TASK:-0}" == 1 ]]; then exit 10; fi
  if [[ -n "\${TASK_SCRIPT:-}" ]]; then bash -c "$TASK_SCRIPT"; exit 0; fi
  if [[ "\${TASK_NO_CHANGE:-0}" == 1 ]]; then exit 0; fi
  mkdir -p 'generated docs'
  printf 'updated reference\\n' > 'generated docs/reference.txt'
  printf 'new reference\\n' > 'generated docs/new.txt'
  rm -f 'generated docs/removed.txt'
  printf 'keep this outside the generated commit\\n' > unrelated.txt
  if [[ "\${STAGE_UNRELATED:-0}" == 1 ]]; then git add -- unrelated.txt; fi
  if [[ "\${TASK_CHANGES_LOCK:-0}" == 1 ]]; then printf 'task update\\n' >> mise.lock; fi
  if [[ -n "\${TASK_INVALID_PATH:-}" ]]; then printf 'invalid artifact\\n' > "$TASK_INVALID_PATH"; fi
  if [[ "\${LITERAL_PATHS:-0}" == 1 ]]; then
    printf 'updated literal path\\n' > 'artifacts[1].txt'
    printf 'keep this outside the generated commit\\n' > artifacts1.txt
  fi
  exit 0
fi
if [[ "\${FAIL_LOCK:-0}" == 1 ]]; then exit 8; fi
if [[ "\${NO_CHANGE:-0}" == 1 ]]; then exit 0; fi
if [[ "\${LOCK_NO_CHANGE:-0}" != 1 ]]; then printf 'updated %s\\n' "$lock" > "$lock"; fi
if [[ "\${SIDECARS:-0}" == 1 ]]; then
  mkdir -p "$sidecars/new"
  printf 'native dependency lock\\n' > "$sidecars/new/package.lock"
  rm -f "$sidecars/old/package.lock"
fi
if [[ "\${REMOVE_SIDECARS:-0}" == 1 ]]; then rm -rf "$sidecars"; fi
if [[ "\${UNRELATED:-0}" == 1 ]]; then
  printf 'keep this outside the generated commit\\n' > unrelated.txt
fi
if [[ "\${UNRELATED_SIDECAR:-0}" == 1 ]]; then
  printf 'unrelated graph change\\n' > "$TEST_REPO/.mise/locks/unrelated/package.lock"
fi
`;

// Temporary repositories must not inherit signing, hooks, or credentials.
const gitEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: gitEnvironment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function readOutputs(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    assert(separator > 0, `Unsupported workflow output: ${line}`);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

export function fixture(t: TestContext, files: Record<string, string> = { 'mise.lock': 'old lock\n' }, defaults: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renovate-mise-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  const bin = join(root, 'bin');
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp);
  mkdirSync(repo);
  mkdirSync(bin);
  const nodeHome = join(root, 'selected-node');
  mkdirSync(join(nodeHome, 'bin'), { recursive: true });
  symlinkSync(process.execPath, join(nodeHome, 'bin', 'node'));
  git(root, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'renovate/test');
  git(repo, 'config', 'user.name', 'Test User');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  write(repo, 'mise.toml', '[tools]\nnode = "24"\n');
  for (const [path, content] of Object.entries(files)) write(repo, path, content);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'initial fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'renovate/test');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(bin, 'mise'), fakeMise, { mode: 0o755 });
  const fallback = join(root, 'fallback'); mkdirSync(fallback);
  writeFileSync(join(fallback, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const log = join(root, 'mise.log');
  writeFileSync(log, '');
  const output = join(runnerTemp, 'update.output');
  writeFileSync(output, '');
  const env: NodeJS.ProcessEnv = {
    ...gitEnvironment,
    PATH: `${bin}:${fallback}:${process.env.PATH}`,
    ...prepareJob.env,
    TEST_LOG: log,
    TEST_REPO: repo,
    TEST_BIN: bin,
    TEST_NODE_HOME: nodeHome,
    RUNNER_TEMP: runnerTemp,
    POST_UPDATE_TASK: '',
    POST_UPDATE_PATHS: '',
    VERIFY_ONLY: 'false',
    HAS_MISE: 'true',
    HAS_VITEPLUS: 'false',
    LOCK_GROUPS: '[]',
    GITHUB_SHA: base,
    GITHUB_PATH: join(runnerTemp, 'path'),
    GITHUB_ENV: join(runnerTemp, 'env'),
    MISE_STATE: join(runnerTemp, 'mise-pnpm-state.json'),
    PREPARED_PATHS: join(runnerTemp, 'mise-lock-artifacts'),
    ...defaults,
  };

  function outputs(): Record<string, string> {
    return readOutputs(output);
  }

  function runScript(script: string, overrides: NodeJS.ProcessEnv = {}): string {
    const exportedEnv = existsSync(env.GITHUB_ENV!) ? readOutputs(env.GITHUB_ENV!) : {};
    const exportedPath = env.GITHUB_PATH!;
    const paths = existsSync(exportedPath) ? readFileSync(exportedPath, 'utf8').split('\n').filter(Boolean).reverse() : [];
    return execFileSync('bash', ['-c', script], {
      cwd: repo,
      env: {
        ...env, ...exportedEnv, BASE_SHA: outputs().base, BRANCH: 'renovate/test', ...overrides,
        PATH: [...paths, overrides.PATH ?? env.PATH].join(':'), GITHUB_OUTPUT: output,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function run(id: string, overrides: NodeJS.ProcessEnv = {}): string {
    if (id === 'update') {
      const hasViteplus = (overrides.HAS_VITEPLUS ?? env.HAS_VITEPLUS) === 'true';
      const state = { ...overrides, VITEPLUS_STATE: hasViteplus ? join(runnerTemp, 'viteplus-state.json') : '' };
      let result = '';
      for (const step of componentSteps('pnpm-outputs')) {
        if (!step.run || (step.id === 'graph' && !hasViteplus)) continue;
        result += runScript(step.run, state);
      }
      return result;
    }
    const step = workflowStep(id);
    assert(step.run, `Workflow step ${id} must define a run script`);
    if (id === 'locks') {
      writeFileSync(output, '');
      writeFileSync(env.GITHUB_PATH!, '');
      writeFileSync(env.GITHUB_ENV!, '');
    }
    return runScript(step.run, overrides);
  }

  let publication = 0;
  function commitPrepared(overrides: NodeJS.ProcessEnv = {}) {
    const publisher = join(root, `publisher-${publication++}`);
    git(root, 'clone', '--branch', 'renovate/test', remote, publisher);
    const step = workflowStep('commit');
    assert(step.run);
    execFileSync('bash', ['-c', step.run], {
      cwd: publisher, env: { ...env, BASE_SHA: outputs().base, ...overrides },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    git(repo, 'fetch', publisher, 'HEAD');
    git(repo, 'reset', '--mixed', 'FETCH_HEAD');
    return publisher;
  }
  // Execute the component's real step order, inputs, conditions and environment
  // exports. Only the remote artifact service is outside this local runner.
  function runComponent(name: string, values: Record<string, string> = {}, overrides: NodeJS.ProcessEnv = {}) {
    const directory = new URL(`../../.github/actions/${name}/`, import.meta.url);
    const action = parse(readFileSync(new URL('action.yml', directory), 'utf8'));
    const inputs: Record<string, string> = Object.fromEntries(Object.entries(action.inputs).map(([key, value]) => [key, values[key] ?? (value as { default: string }).default]));
    const steps: Record<string, { outputs: Record<string, string> }> = {};
    const expand = (value: string) => value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_match, expression: string) => {
      if (expression === 'github.action_path') return directory.pathname;
      if (expression === 'github.token') return '';
      const input = /^inputs\['([^']+)'\]$/.exec(expression);
      if (input) return inputs[input[1]!] ?? '';
      const output = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(expression);
      if (output) return steps[output[1]!]?.outputs[output[2]!] ?? '';
      throw new Error(`Unsupported component expression: ${expression}`);
    });
    let result = '';
    for (const step of action.runs.steps as WorkflowStep[]) {
      if (step.if && !runInNewContext(step.if, { inputs, steps })) continue;
      if (!step.run) continue;
      const start = readFileSync(output, 'utf8').length;
      const resolvedEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, expand(value)]));
      result += runScript(step.run, { ...overrides, ...resolvedEnv });
      const emitted = readFileSync(output, 'utf8').slice(start).trim().split('\n').filter(Boolean);
      if (step.id) steps[step.id] = { outputs: Object.fromEntries(emitted.map(line => {
        const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
      })) };
    }
    const returned = Object.fromEntries(Object.entries(action.outputs).map(([key, value]) => [key, expand((value as { value: string }).value)]));
    return { result, outputs: returned };
  }

  function prepare(overrides: NodeJS.ProcessEnv = {}) {
    writeFileSync(output, ''); writeFileSync(env.GITHUB_PATH!, ''); writeFileSync(env.GITHUB_ENV!, '');
    const verifyOnly = overrides.VERIFY_ONLY ?? env.VERIFY_ONLY!;
    const mise = runComponent('mise-pnpm', { 'verify-only': verifyOnly, 'lock-groups': overrides.LOCK_GROUPS ?? env.LOCK_GROUPS! }, overrides);
    const viteplus = (overrides.HAS_VITEPLUS ?? env.HAS_VITEPLUS) === 'true'
      ? runComponent('pnpm-viteplus', { 'verify-only': verifyOnly, 'prepared-paths': mise.outputs['artifact-paths']! }, overrides)
      : undefined;
    return runComponent('pnpm-outputs', {
      'verify-only': verifyOnly, 'mise-state': mise.outputs.state!, 'viteplus-state': viteplus?.outputs.state ?? '',
      'post-update-task': overrides.POST_UPDATE_TASK ?? env.POST_UPDATE_TASK!,
      'post-update-paths': overrides.POST_UPDATE_PATHS ?? env.POST_UPDATE_PATHS!,
    }, overrides).result;
  }

  function update(overrides: NodeJS.ProcessEnv = {}) {
    const result = prepare(overrides);
    if ((overrides.VERIFY_ONLY ?? env.VERIFY_ONLY) !== 'true' && outputs().changed === 'true') commitPrepared(overrides);
    return result;
  }

  function assertUnpublished(): void {
    assert.equal(git(repo, 'rev-parse', 'HEAD'), base);
    assert.equal(git(root, '--git-dir', remote, 'rev-parse', 'refs/heads/renovate/test'), base);
  }

  function assertNoPayload(): void {
    assert.notEqual(outputs().changed, 'true');
    assert(!existsSync(join(runnerTemp, 'pnpm-artifacts/changes.patch')));
  }

  return { root, repo, remote, bin, log, base, run, runComponent, runScript, outputs, commitPrepared, prepare, update, assertUnpublished, assertNoPayload, runnerTemp };
}
