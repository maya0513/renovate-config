import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  id?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
}

interface WorkflowJob {
  if: string;
  env: Record<string, string>;
  steps: WorkflowStep[];
}

function readJob(): WorkflowJob {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/mise-lock.yml', import.meta.url), 'utf8')) as {
    jobs: Record<string, WorkflowJob>;
  };
  const job = workflow.jobs['mise-lock'];
  assert(job, 'The reusable workflow must define the mise-lock job');
  return job;
}

export const miseLockJob = readJob();

function workflowStep(id: string): WorkflowStep {
  const step = miseLockJob.steps.find((step) => step.id === id);
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

export function fixture(t: TestContext, files: Record<string, string> = { 'mise.lock': 'old lock\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'renovate-mise-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  const bin = join(root, 'bin');
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp);
  mkdirSync(repo);
  mkdirSync(bin);
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
  const log = join(root, 'mise.log');
  writeFileSync(log, '');
  const output = join(runnerTemp, 'update.output');
  writeFileSync(output, '');
  const env: NodeJS.ProcessEnv = {
    ...gitEnvironment,
    PATH: `${bin}:${process.env.PATH}`,
    ...miseLockJob.env,
    TEST_LOG: log,
    TEST_REPO: repo,
    RUNNER_TEMP: runnerTemp,
    POST_UPDATE_TASK: '',
    POST_UPDATE_PATHS: '',
    VERIFY_ONLY: 'false',
  };

  function outputs(): Record<string, string> {
    return readOutputs(output);
  }

  function runScript(script: string, overrides: NodeJS.ProcessEnv = {}): string {
    return execFileSync('bash', ['-c', script], {
      cwd: repo,
      env: { ...env, BASE_SHA: outputs().base, BRANCH: 'renovate/test', ...overrides, GITHUB_OUTPUT: output },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function run(id: string, overrides: NodeJS.ProcessEnv = {}): string {
    const step = workflowStep(id);
    assert(step.run, `Workflow step ${id} must define a run script`);
    if (id === 'update') writeFileSync(output, '');
    return runScript(step.run, overrides);
  }

  return { root, repo, remote, bin, log, base, run, runScript, outputs, update: (overrides: NodeJS.ProcessEnv = {}) => run('update', overrides) };
}
