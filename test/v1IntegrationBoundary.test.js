import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);

test('v1 integration boundary has no legacy frontend surface', () => {
  for (const directory of ['frontend', 'electron', 'public']) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, directory)),
      false,
      `legacy repository directory must not exist: ${directory}`,
    );
  }

  assert.equal(packageJson.main, undefined, 'package.json must not define an Electron main entry');

  for (const script of ['desktop', 'dev:ui', 'build:ui']) {
    assert.equal(
      packageJson.scripts?.[script],
      undefined,
      `legacy frontend script must be absent: ${script}`,
    );
  }

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const dependency of ['react', 'react-dom', 'vite', 'electron']) {
    assert.equal(
      dependencies[dependency],
      undefined,
      `legacy frontend dependency must be absent: ${dependency}`,
    );
  }

  assert.equal(packageJson.scripts?.start, 'npm run pilot:terminal');
});
