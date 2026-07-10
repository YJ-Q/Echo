import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package exposes reproducible Windows packaging commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(pkg.scripts['pack:win'], 'npm run prepack:win && electron-builder --win --x64 --dir');
  assert.equal(pkg.scripts['dist:win'], 'npm run prepack:win && electron-builder --win nsis --x64');
  assert.equal(
    pkg.scripts['prepack:win'],
    'npm run lint:ui && npm run build:ui && npm test'
  );
  assert.ok(pkg.devDependencies['electron-builder']);
});

test('builder configuration preserves user data and unpacks sqlite3', async () => {
  const config = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8');

  assert.match(config, /appId: cn\.margin\.desktop/);
  assert.match(config, /artifactName: Margin-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
  assert.match(config, /node_modules\/sqlite3\/\*\*\/\*/);
  assert.match(config, /deleteAppDataOnUninstall: false/);
  assert.match(config, /target: nsis/);
});
