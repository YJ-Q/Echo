import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMarginCore } from '../src/core/createMarginCore.js';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';

const pinnedNode = path.resolve('.runtime/node-v22.23.1-win-x64/node.exe');

function fakeRuntime(calls) {
  let sequence = 0;
  return {
    async createSession() {
      const id = `fake-pi-${++sequence}`;
      return { id, async send() { return { text: '', toolResults: [] }; }, async close() { calls.push(['session.close', id]); } };
    },
    async haltSession(id) { calls.push(['runtime.haltSession', id]); return { halted: true }; },
    async close() { calls.push(['runtime.close']); }
  };
}

async function fixture({ dev = false } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'margin-web-composition-'));
  const staticDir = path.join(rootDir, 'web', 'dist');
  await mkdir(staticDir, { recursive: true });
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Margin Workbench</title>', 'utf8');
  const dbPath = path.join(rootDir, 'configured', 'core.sqlite');
  const calls = [];
  let coreOpenCount = 0;
  let coreCloseCount = 0;
  let viteCloseCount = 0;
  const dependencies = {
    async createMarginCore(options) {
      coreOpenCount += 1;
      calls.push(['core.open', options.dbPath]);
      const core = await createMarginCore(options);
      const close = core.close;
      core.close = async () => { coreCloseCount += 1; await close(); };
      return core;
    },
    async createPiTerminalPilotRuntime(options) {
      calls.push(['runtime.config', options.provider, options.modelId, options.customProvider.baseUrl, options.customProvider.api, Boolean(options.customProvider.apiKey)]);
      return fakeRuntime(calls);
    },
    async createViteServer() {
      return {
        middlewares(request, response, next) {
          if (request.url === '/__vite_probe') return response.end('vite-ok');
          return next();
        },
        async close() { viteCloseCount += 1; }
      };
    }
  };
  const workbench = await createWebWorkbench({
    rootDir, dbPath, staticDir, dev, host: '127.0.0.1', port: 0,
    env: { YAPI_API_KEY: 'present-for-test' }, dependencies
  });
  return {
    rootDir, staticDir, dbPath, calls, workbench,
    get coreOpenCount() { return coreOpenCount; },
    get coreCloseCount() { return coreCloseCount; },
    get viteCloseCount() { return viteCloseCount; },
    async cleanup() { await workbench.close().catch(() => {}); await rm(rootDir, { recursive: true, force: true }); }
  };
}

test('composition opens exactly one configured Core, uses terminal-safe Pi defaults, binds loopback, and closes once', async () => {
  const f = await fixture();
  try {
    const started = await f.workbench.start();
    assert.equal(f.coreOpenCount, 1);
    assert.deepEqual(f.calls.find(([kind]) => kind === 'core.open'), ['core.open', f.dbPath]);
    assert.deepEqual(f.calls.find(([kind]) => kind === 'runtime.config'), [
      'runtime.config', 'yapi', 'gpt-5.6-terra', 'https://yapi.click/v1', 'openai-responses', true
    ]);
    assert.equal(started.host, '127.0.0.1');
    assert.ok(started.port > 0);
    const health = await fetch(`${started.origin}/api/health`).then((response) => response.json());
    assert.deepEqual(health, { ok: true, status: 'ready', contractVersion: '1.0' });

    await f.workbench.close();
    await f.workbench.close();
    assert.equal(f.coreCloseCount, 1);
    assert.equal(f.calls.filter(([kind]) => kind === 'runtime.close').length, 1);
  } finally { await f.cleanup(); }
});

test('development uses injected Vite middleware and closes it once', async () => {
  const f = await fixture({ dev: true });
  try {
    const started = await f.workbench.start();
    assert.equal(await fetch(`${started.origin}/__vite_probe`).then((response) => response.text()), 'vite-ok');
    await f.workbench.close();
    await f.workbench.close();
    assert.equal(f.viteCloseCount, 1);
  } finally { await f.cleanup(); }
});

test('production composition fails clearly before opening Core when web assets are absent', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'margin-web-missing-assets-'));
  let opens = 0;
  try {
    await assert.rejects(
      createWebWorkbench({ rootDir, dbPath: path.join(rootDir, 'core.sqlite'), dependencies: { async createMarginCore() { opens += 1; } } }),
      /web_assets_missing.*npm run build/u
    );
    assert.equal(opens, 0);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test('web composition and entrypoint have no legacy application, route, store, or echo database imports', async () => {
  for (const relative of ['src/web/createWebWorkbench.js', 'scripts/run-web-workbench.js']) {
    const source = await readFile(path.resolve(relative), 'utf8');
    const imports = [...source.matchAll(/import(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.equal(imports.some((specifier) => /(?:^|\/)app\.js$|routes\/|storage\/memoryStore|echo\.sqlite/iu.test(specifier)), false, relative);
  }
});

test('environment selects the configured Core path and ephemeral listen port', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'margin-web-env-config-'));
  const staticDir = path.join(rootDir, 'web', 'dist');
  const configured = path.join('isolated', 'configured.sqlite');
  let openedPath;
  let workbench;
  try {
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html>', 'utf8');
    workbench = await createWebWorkbench({
      rootDir, staticDir,
      env: { MARGIN_CORE_DB_PATH: configured, MARGIN_WEB_HOST: '127.0.0.1', PORT: '0' },
      dependencies: {
        async createMarginCore(options) { openedPath = options.dbPath; return createMarginCore(options); }
      }
    });
    const started = await workbench.start();
    assert.equal(openedPath, path.resolve(rootDir, configured));
    assert.equal(started.host, '127.0.0.1');
    assert.ok(started.port > 0);
  } finally {
    await workbench?.close().catch(() => {});
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('package, Docker, environment example, and launchers expose exact Phase 2B entrypoint semantics', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  assert.equal(packageJson.scripts.build, 'vite build --config web/vite.config.js');
  assert.equal(packageJson.scripts.start, '.\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-web-workbench.js');
  assert.equal(packageJson.scripts.dev, '.\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-web-workbench.js --dev');
  assert.equal(packageJson.scripts['pilot:terminal'], '.\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-terminal-pilot.js');
  assert.equal(packageJson.scripts['legacy:api'], '.\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-legacy-api.js');
  assert.doesNotMatch(packageJson.scripts.start, /build/u);

  const [dockerfile, compose, marginLauncher, echoLauncher, envExample] = await Promise.all([
    readFile(path.resolve('Dockerfile'), 'utf8'), readFile(path.resolve('docker-compose.yml'), 'utf8'),
    readFile(path.resolve('run-margin-local.cmd'), 'utf8'), readFile(path.resolve('run-echo-local.cmd'), 'utf8'),
    readFile(path.resolve('.env.example'), 'utf8')
  ]);
  assert.match(dockerfile, /npm run build/u);
  assert.match(dockerfile, /scripts\/run-web-workbench\.js/u);
  assert.match(dockerfile, /MARGIN_WEB_HOST=0\.0\.0\.0/u);
  assert.match(compose, /terminal-pilot\/margin-core\.sqlite/u);
  assert.match(compose, /MARGIN_WEB_HOST=0\.0\.0\.0/u);
  assert.match(marginLauncher, /scripts\\run-web-workbench\.js/u);
  assert.doesNotMatch(marginLauncher, /src\\server\.js/u);
  assert.match(echoLauncher, /deprecated/iu);
  assert.match(echoLauncher, /scripts\\run-legacy-api\.js/u);
  assert.match(envExample, /MARGIN_CORE_DB_PATH=.*terminal-pilot\/margin-core\.sqlite/u);
});

test('legacy server direct launch is gated and the deliberate wrapper owns the opt-in flag', async () => {
  const env = { ...process.env };
  delete env.MARGIN_ENABLE_LEGACY_API;
  const blocked = spawnSync(pinnedNode, ['src/server.js'], { cwd: path.resolve('.'), env, encoding: 'utf8', timeout: 2_000 });
  assert.equal(blocked.status, 1, blocked.error?.message ?? blocked.stderr);
  assert.match(`${blocked.stdout}${blocked.stderr}`, /legacy_api_disabled/u);

  const wrapper = await readFile(path.resolve('scripts/run-legacy-api.js'), 'utf8');
  assert.match(wrapper, /MARGIN_ENABLE_LEGACY_API\s*=\s*['"]true['"]/u);
  assert.match(wrapper, /deprecated/iu);
});
