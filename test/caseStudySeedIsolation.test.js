import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import test from 'node:test';

test('case study operation seed writes only its explicit temporary database', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-case-study-seed-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const sentinelPath = path.join(tempDir, 'sentinel.sqlite');
  const targetPath = path.join(tempDir, 'capture.sqlite');
  const sentinel = Buffer.from('must-not-change');
  await writeFile(sentinelPath, sentinel);

  const result = await runNode([
    'scripts/case-study/seed-operation-event.mjs',
    targetPath
  ], {
    ...process.env,
    MARGIN_DB_PATH: sentinelPath,
    ECHO_DB_PATH: sentinelPath
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readFile(sentinelPath), sentinel);

  const database = await open({ filename: targetPath, driver: sqlite3.Database });
  try {
    const row = await database.get(
      "SELECT COUNT(*) AS count FROM operation_events WHERE event_type = 'review_snapshot_created'"
    );
    assert.equal(row.count, 1);
  } finally {
    await database.close();
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
