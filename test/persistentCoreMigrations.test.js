import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';

test('migration 3 adds persistent work tables and workstream fields', async () => {
  const fixture = await createMarginCoreTestDb();
  try {
    const tables = (await fixture.store.db.all("SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    for (const name of ['margin_runs', 'margin_artifacts', 'margin_checkpoints']) assert.equal(tables.includes(name), true, name);
    const columns = (await fixture.store.db.all('PRAGMA table_info(margin_projects)')).map((row) => row.name);
    for (const name of ['title', 'workstream_status', 'current_plan', 'next_action', 'blockers', 'dependencies', 'workspace_path', 'autonomy_level', 'artifact_refs', 'last_checkpoint_id']) {
      assert.equal(columns.includes(name), true, name);
    }
    assert.deepEqual((await fixture.store.getSchemaEvidence()).map((row) => row.version), [1, 2, 3]);
  } finally {
    await fixture.cleanup();
  }
});
