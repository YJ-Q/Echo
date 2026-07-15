import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('package exposes the opt-in provider probe command', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['probe:providers'], 'node scripts/probe-providers.mjs');
});

test('live probe exits safely when the selected provider is not configured', () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const result = spawnSync(process.execPath, [
    'scripts/probe-providers.mjs',
    '--provider=openai',
    '--capability=conversation'
  ], {
    cwd: new URL('..', import.meta.url),
    env,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /provider_not_configured/);
  assert.equal(result.stderr.includes('OPENAI_API_KEY='), false);
});
