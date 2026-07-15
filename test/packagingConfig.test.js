import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package exposes reproducible Windows packaging commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(pkg.scripts['pack:win'], 'npm run prepack:win && electron-builder --win --x64 --dir');
  assert.equal(pkg.scripts['dist:win'], 'npm run prepack:win && electron-builder --win nsis --x64');
  assert.equal(
    pkg.scripts['prepack:win'],
    'npm run lint:ui && npm run build:ui && npm run build:icon && npm test'
  );
  assert.equal(pkg.scripts['build:icon'], 'node scripts/build-icon.mjs');
  assert.ok(pkg.devDependencies['electron-builder']);
  assert.ok(pkg.devDependencies.sharp);
});

test('builder configuration preserves user data and unpacks sqlite3', async () => {
  const config = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8');

  assert.match(config, /appId: cn\.margin\.desktop/);
  assert.match(config, /artifactName: Margin-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
  assert.match(config, /node_modules\/sqlite3\/\*\*\/\*/);
  assert.match(config, /deleteAppDataOnUninstall: false/);
  assert.match(config, /target: nsis/);
  assert.match(config, /icon: build\/icon\.png/);
});

test('Windows CI builds, smokes, hashes, and uploads the installer', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/windows-release.yml', import.meta.url),
    'utf8'
  );

  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /smoke-win-installer\.ps1/);
  assert.match(workflow, /Get-FileHash/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
