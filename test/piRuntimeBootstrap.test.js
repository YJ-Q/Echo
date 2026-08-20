import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../scripts/bootstrap-pi-runtime.ps1', import.meta.url);

test('runtime bootstrap pins Node and verifies the official SHA256 manifest', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /\$NodeVersion = '22\.23\.1'/);
  assert.match(source, /node-v\$NodeVersion-win-x64\.zip/);
  assert.match(source, /SHASUMS256\.txt/);
  assert.match(source, /Get-FileHash[^\r\n]+SHA256/);
  assert.match(source, /Hash mismatch/);
});

test('runtime bootstrap confines installation to the ignored repository runtime', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /\.runtime/);
  assert.match(source, /node-v\$NodeVersion-win-x64/);
  assert.match(source, /StartsWith\(\$runtimePrefix/);
  assert.match(source, /Remove-Item -LiteralPath \$temporaryRoot -Recurse -Force/);
});

test('runtime bootstrap is idempotent for an already valid executable', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /Test-Path -LiteralPath \$nodeExe/);
  assert.match(source, /if \(\$installedVersion -eq "v\$NodeVersion"\)/);
  assert.match(source, /exit 0/);
});
