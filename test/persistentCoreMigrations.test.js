import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { MARGIN_CORE_MIGRATIONS } from '../src/core/migrations/001-margin-core.js';
import { PERSISTENT_WORK_MIGRATION } from '../src/core/migrations/003-persistent-work.js';

test('migration 3 adds persistent work tables and workstream fields', async () => {
  const fixture = await createMarginCoreTestDb();
  try {
    const tables = (await fixture.store.db.all("SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    for (const name of ['margin_runs', 'margin_artifacts', 'margin_checkpoints']) assert.equal(tables.includes(name), true, name);
    const columns = (await fixture.store.db.all('PRAGMA table_info(margin_projects)')).map((row) => row.name);
    for (const name of ['title', 'workstream_status', 'current_plan', 'next_action', 'blockers', 'dependencies', 'workspace_path', 'autonomy_level', 'artifact_refs', 'last_checkpoint_id']) {
      assert.equal(columns.includes(name), true, name);
    }
    assert.deepEqual((await fixture.store.getSchemaEvidence()).map((row) => row.version), [1, 2, 3, 4]);
  } finally {
    await fixture.cleanup();
  }
});

test('migration 3 maps legacy project statuses into Workstream semantics', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-migration-map-'));
  const db = await open({ filename: path.join(directory, 'legacy.sqlite'), driver: sqlite3.Database });
  try {
    await db.exec(MARGIN_CORE_MIGRATIONS[0].sql);
    await db.exec(MARGIN_CORE_MIGRATIONS[1].sql);
    for (const status of ['active', 'blocked', 'completed', 'archived']) {
      await db.run('INSERT INTO margin_projects VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', status, 'career_project', status, 'legacy', status, 1, 'session', 'event', '2026-08-23', '2026-08-23');
    }
    await db.exec(PERSISTENT_WORK_MIGRATION.sql);
    const rows = await db.all('SELECT id,workstream_status FROM margin_projects ORDER BY id');
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.workstream_status])), {
      active: 'running', archived: 'completed', blocked: 'blocked', completed: 'completed'
    });
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
