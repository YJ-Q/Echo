import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { closeMemoryStore, configureMemoryStore, ensureMemoryStore } from '../src/storage/memoryStore.js';

const execFile = promisify(execFileCallback);
const workspaceRoot = path.resolve('.');
const tableNames = [
  'conversations',
  'user_states',
  'user_profile',
  'learning_sessions',
  'learning_events',
  'actions',
  'operation_proposals',
  'operation_events',
  'summaries'
];

test('backup script consumes MARGIN_DB_PATH', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-backup-script-'));
  const dbPath = path.join(tempDir, 'configured-margin.sqlite');
  const outDir = path.join(tempDir, 'exports');

  try {
    configureMemoryStore({ dbPath });
    await ensureMemoryStore();
    await closeMemoryStore();
    configureMemoryStore({ dbPath: '' });

    const result = await runScript('scripts/backup-data.js', [
      '--format=json',
      `--out-dir=${outDir}`
    ], { MARGIN_DB_PATH: dbPath });
    const snapshot = JSON.parse(await readFile(result.files[0].file_path, 'utf8'));

    assert.equal(snapshot.source.db_path, dbPath);
  } finally {
    await closeMemoryStore();
    configureMemoryStore({ dbPath: '' });
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import script consumes MARGIN_DB_PATH when --db-path is omitted', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-import-script-'));
  const dbPath = path.join(tempDir, 'configured-margin.sqlite');
  const snapshotPath = path.join(tempDir, 'snapshot.json');

  try {
    await writeFile(snapshotPath, JSON.stringify({
      data: Object.fromEntries(tableNames.map((table) => [table, []]))
    }), 'utf8');

    const result = await runScript('scripts/import-data.js', [
      `--file=${snapshotPath}`,
      '--dry-run'
    ], { MARGIN_DB_PATH: dbPath });

    assert.equal(result.target_db_path, dbPath);
  } finally {
    await closeMemoryStore();
    configureMemoryStore({ dbPath: '' });
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function runScript(script, args, env) {
  const { stdout } = await execFile(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    env: { ...process.env, ...env }
  });

  return JSON.parse(stdout);
}
