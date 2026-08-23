import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('package and application expose an API-only runtime', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.equal(packageJson.main, undefined);
  assert.equal(packageJson.scripts?.desktop, undefined);
  assert.equal(packageJson.devDependencies?.electron, undefined);
  assert.equal(packageJson.scripts?.test, '.\\.runtime\\node-v22.23.1-win-x64\\node.exe --test "test/*.test.js"');
  assert.doesNotMatch(appSource, /express\.static|publicDir/);
  assert.doesNotMatch(appSource, /desktop-style frontend|ui-connected/);
  assert.match(appSource, /Margin API is running\./);
});
