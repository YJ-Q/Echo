import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('Stage 0 verifier checks runtime, audit, tests, and real spike evidence in order', async () => {
  const source = await readFile(new URL('../scripts/verify-pi-stage-0.ps1', import.meta.url), 'utf8');
  const markers = [
    '--version',
    'scripts/audit-pi-baseline.js',
    'test/piBaseline.test.js',
    'Get-ChildItem -LiteralPath',
    "-Arguments (@('--test') + $testFiles)",
    'data\\pi-spike\\report.json'
  ];
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.ok(index > previous, `${marker} must appear after the previous verification step`);
    previous = index;
  }
  assert.match(source, /exit 3/);
  assert.match(source, /pi_credentials_required/);
  assert.doesNotMatch(source, /MARGIN_PI_PROVIDER\s*=/);
  assert.doesNotMatch(source, /MARGIN_PI_MODEL\s*=/);
  assert.doesNotMatch(source, /npm\.cmd/);
  assert.doesNotMatch(source, /--test test\s/);
  assert.match(source, /MARGIN_PI_PROVIDER/);
  assert.match(source, /MARGIN_PI_MODEL/);
  assert.match(source, /15/);
});

test('Stage 0 verifier is valid PowerShell syntax', () => {
  const scriptPath = new URL('../scripts/verify-pi-stage-0.ps1', import.meta.url).pathname.slice(1);
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `[scriptblock]::Create((Get-Content -Raw -LiteralPath '${scriptPath}')) | Out-Null`],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});
