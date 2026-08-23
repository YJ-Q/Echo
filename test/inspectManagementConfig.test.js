import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('management inspection script injects the centralized runtime database path', async () => {
  const source = await readFile('scripts/inspect-management.js', 'utf8');

  assert.match(source, /loadRuntimeConfig/);
  assert.match(source, /configureMemoryStore\(\{\s*dbPath:\s*config\.dbPath\s*\}\)/);
});

test('management inspection honors current and legacy configured database paths', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-management-inspect-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  for (const [key, fileName] of [
    ['MARGIN_DB_PATH', 'current.sqlite'],
    ['ECHO_DB_PATH', 'legacy.sqlite']
  ]) {
    const dbPath = path.join(tempDir, fileName);
    const env = { ...process.env };
    delete env.MARGIN_DB_PATH;
    delete env.ECHO_DB_PATH;
    env[key] = dbPath;

    const result = await runNode(['scripts/inspect-management.js', '--json'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).scope, 'all');
    await readFile(dbPath);
  }
});

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
