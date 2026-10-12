import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import type { TestContext } from 'node:test';

// A local registry makes real pnpm transitions deterministic and independent of
// public releases, credentials, the user's store, and native Vite+ binaries.
export async function packageRegistry(t: TestContext, root: string) {
  const directory = join(root, 'registry');
  mkdirSync(directory);
  const definitions: Record<string, Record<string, unknown>> = {};
  let serial = 0;
  function add(name: string, version: string, dependencies: Record<string, string> = {}) {
    const id = String(serial++);
    const staging = join(directory, id, 'package');
    mkdirSync(staging, { recursive: true });
    const manifest = { name, version, dependencies, main: 'index.js' };
    writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(staging, 'index.js'), 'module.exports = {};\n');
    const tarball = join(directory, `${id}.tgz`);
    execFileSync('tar', ['czf', tarball, '-C', join(directory, id), 'package']);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    (definitions[name] ??= {})[version] = { ...manifest, dist: { tarball: `${id}.tgz`, integrity } };
  }
  const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
  add('pnpm', pnpmVersion);
  for (const [vitest, core, vp] of [['5.0.1', '1.0.0', '1.0.0'], ['5.0.2', '1.0.1', '1.0.1']] as const) {
    add('vitest', vitest);
    add('@vitest/coverage-v8', vitest, { vitest });
    add('@voidzero-dev/vite-plus-core', core);
    add('vite-plus', vp, { vitest, vite: `npm:@voidzero-dev/vite-plus-core@${core}` });
  }
  add('ordinary', '1.0.0', { transitive: '1.0.0' });
  add('transitive', '1.0.0');
  const metadata = join(directory, 'metadata.json');
  writeFileSync(metadata, JSON.stringify(definitions));
  const server = join(directory, 'server.mjs');
  writeFileSync(server, `
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (/^\\d+\\.tgz$/.test(name)) {
    res.end(readFileSync(join(root, name)));
    return;
  }
  const definitions = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8'));
  if (!definitions[name]) { res.writeHead(404); res.end('{}'); return; }
  const versions = Object.fromEntries(Object.entries(definitions[name]).map(([version, pkg]) => [version, {
    ...pkg, dist: { ...pkg.dist, tarball: 'http://127.0.0.1:' + server.address().port + '/' + pkg.dist.tarball },
  }]));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name, versions, 'dist-tags': { latest: Object.keys(versions).at(-1) } }));
});
server.listen(0, '127.0.0.1', () => process.send(server.address().port));
`);
  const child = spawn(process.execPath, [server, directory], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });
  const [port] = await once(child, 'message');
  return {
    pnpmVersion,
    env: {
      pnpm_config_registry: `http://127.0.0.1:${port}/`,
      pnpm_config_store_dir: join(root, 'store'),
      pnpm_config_cache_dir: join(root, 'cache'),
      XDG_CACHE_HOME: join(root, 'cache'),
      XDG_STATE_HOME: join(root, 'state'),
      XDG_DATA_HOME: join(root, 'data'),
      CI: 'true',
    },
    publishOrdinary() {
      add('ordinary', '1.0.1', { transitive: '1.0.0' });
      writeFileSync(metadata, JSON.stringify(definitions));
    },
  };
}
