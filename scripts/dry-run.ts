import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenovateConfig } from 'renovate/dist/config/types.js';
import { resolveConfigPresets } from 'renovate/dist/config/presets/index.js';
import { mergeChildConfig } from 'renovate/dist/config/utils.js';
import { init as initLogger } from 'renovate/dist/logger/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'mise.toml',
  'mise.lock',
  '.github',
];

export async function resolveLocalConfig(preset: RenovateConfig, repositoryConfig: RenovateConfig): Promise<RenovateConfig> {
  const { extends: references = [], ...overrides } = repositoryConfig;
  let config: RenovateConfig = {};
  for (const reference of references) {
    if (repositoryConfig.ignorePresets?.includes(reference)) continue;
    const localOptional = ['mise-pnpm', 'viteplus'].find(name => reference === `local>maya0513/renovate-config//presets/${name}`);
    const layer = reference === 'local>maya0513/renovate-config' ? preset
      : localOptional ? JSON.parse(readFileSync(join(root, 'presets', `${localOptional}.json`), 'utf8')) as RenovateConfig
      : { extends: [reference] };
    const { config: resolved } = await resolveConfigPresets({ ...layer, ignorePresets: repositoryConfig.ignorePresets });
    config = mergeChildConfig(config, resolved);
  }
  const { config: resolvedOverrides } = await resolveConfigPresets(overrides);
  return mergeChildConfig(config, resolvedOverrides);
}

if (import.meta.main) {
  const temporary = mkdtempSync(join(tmpdir(), 'renovate-config-dry-run-'));
  const repository = join(temporary, 'repository');

  try {
    await initLogger();
    // An explicit list keeps credentials, node_modules, and Git metadata out.
    for (const name of sourceFiles) {
      cpSync(join(root, name), join(repository, name), { recursive: true });
    }
    // Resolve this repository's overrides against the unpublished local preset.
    const preset: RenovateConfig = JSON.parse(readFileSync(join(root, 'default.json'), 'utf8'));
    const ownConfig: RenovateConfig = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
    const config = await resolveLocalConfig(preset, ownConfig);
    // The local platform cannot sync Git submodules in this metadata-free copy.
    config.cloneSubmodules = false;
    writeFileSync(join(repository, 'renovate.json'), JSON.stringify(config));
    console.log('Inspecting a temporary copy with the local preset (platform=local, dry-run=lookup).');
    const result = spawnSync(process.execPath, [
      fileURLToPath(import.meta.resolve('renovate/dist/renovate.js')),
      '--platform=local',
      '--dry-run=lookup',
      '--onboarding=false',
      '--require-config=required',
      `--base-dir=${join(temporary, 'cache')}`,
      '--binary-source=global',
    ], {
      cwd: repository,
      env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL || 'info' },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
