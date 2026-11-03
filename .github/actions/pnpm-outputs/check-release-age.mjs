import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';

function fail(message) {
  throw new Error(`pnpm release-age policy: ${message}`);
}

function pnpm(...args) {
  const result = spawnSync('pnpm', [...args, '--ignore-pnpmfile', '--pm-on-fail=error'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Configuration output may contain registry credentials. Never print either
  // stream, including on failure or invalid JSON.
  if (result.status !== 0) {
    const code = ['ERR_PNPM_BAD_PM_VERSION', 'ERR_PNPM_UNSUPPORTED_ENGINE']
      .find(value => `${result.stdout}${result.stderr}`.includes(value));
    fail(`Cannot read pnpm configuration${code ? ` (${code})` : ''}. Prepare the declared pnpm executable and check its configuration.`);
  }
  return result.stdout.trim();
}

try {
  if (!lstatSync('pnpm-workspace.yaml').isFile()) fail('pnpm-workspace.yaml must be a regular file in the project root.');
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(pnpm('--version'));
  if (!version || Number(version[1]) < 12 || (Number(version[1]) === 12 &&
    (Number(version[2]) < 10 || (Number(version[2]) === 10 && Number(version[3]) < 1)))) {
    fail('Use stable pnpm 12.10.1 or newer; older versions are outside the verified policy contract.');
  }
  const configuration = pnpm('config', 'list', '--json');
  let config;
  try { config = JSON.parse(configuration); }
  catch { fail('Cannot read effective pnpm configuration as JSON.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Expected a pnpm configuration object.');
  if (!Number.isSafeInteger(config.minimumReleaseAge) || config.minimumReleaseAge < 10080) {
    fail('Set minimumReleaseAge to at least 10080 minutes (7 days) in pnpm-workspace.yaml; remove weaker environment overrides.');
  }
  // With an explicitly configured age, supported pnpm versions default to
  // strict mode. Accept that native default as well as explicit true.
  if (config.minimumReleaseAgeStrict !== undefined && config.minimumReleaseAgeStrict !== true) {
    fail('minimumReleaseAgeStrict must be true; immature resolutions must fail.');
  }
  if (config.minimumReleaseAgeIgnoreMissingTime !== false) {
    fail('Set minimumReleaseAgeIgnoreMissingTime: false; packages without publication timestamps must not bypass the policy.');
  }
  if (config.trustLockfile !== undefined && config.trustLockfile !== false) {
    fail('trustLockfile must be false; frozen installs must retain pnpm lockfile policy verification.');
  }
  const exceptions = config.minimumReleaseAgeExclude ?? [];
  // One exact SemVer per entry. Package-wide and wildcard exclusions would
  // silently exempt future releases. The reason for an exception is reviewed
  // by the consumer; a security label is not proof of a safe resolution.
  const exact = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!Array.isArray(exceptions) || !exceptions.every(value => typeof value === 'string' && exact.test(value))) {
    fail('minimumReleaseAgeExclude accepts only reviewed package@x.y.z entries (including scoped packages and exact prereleases); package-wide exclusions, ranges and wildcards are not allowed.');
  }
  console.log(`pnpm release-age policy passed: ${config.minimumReleaseAge} minutes, ${exceptions.length} version-specific exception(s).`);
} catch (error) {
  // A missing file and a child failure both get actionable messages without
  // exposing pnpm's captured configuration or registry credentials.
  console.error(error?.code === 'ENOENT'
    ? 'pnpm release-age policy: Add pnpm-workspace.yaml in the project root with the required policy settings.'
    : error.message);
  process.exitCode = 1;
}
