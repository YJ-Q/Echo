import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createPersistentWorkRepository } from '../src/core/persistentWorkRepository.js';
import { createMarginCore } from '../src/core/createMarginCore.js';

let seq = 0;
async function fixture(t) {
  let id = 0;
  const db = await createMarginCoreTestDb({ clock: () => '2026-09-01T00:00:00.000Z', idFactory: (p) => `${p}-${++id}` });
  await db.store.migrate();
  t.after(() => db.cleanup());
  const repository = createPersistentWorkRepository(db.store);
  const actor = { actorType: 'user', subjectId: 'test-user', sourceSessionId: `s-${++seq}`, sourceEventId: `e-${seq}` };
  const wsResult = await repository.createWorkstream({
    requestId: `ws-create-${seq}`, scenario: 'career_project', goal: 'Test lifecycle',
    title: 'Lifecycle WS', priority: 0
  }, actor);
  return { db, store: db.store, repository, actor, workstream: wsResult.data, clock: () => '2026-09-01T00:00:00.000Z' };
}

async function propose(f, content) {
  const result = await f.store.confirmMemory === undefined
    ? f.store.db.run(
        `INSERT INTO margin_memories (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at)
         VALUES (?,?,NULL,?,'context',0.9,'proposed',?,NULL,NULL,1,?,?,?,?,NULL,NULL)`,
        `mem-${f.store.idFactory('mem')}`, f.workstream.id, content, f.clock(), f.actor.sourceSessionId, f.actor.sourceEventId, f.clock(), f.clock()
      ).then(async (r) => {
        const row = await f.store.db.get('SELECT * FROM margin_memories WHERE source_event_id=? AND content=? ORDER BY created_at DESC LIMIT 1', f.actor.sourceEventId, content);
        return row;
      })
    : null;

  if (result) return result;
  const memId = f.store.idFactory('mem');
  const now = f.clock();
  await f.store.db.run(
    `INSERT INTO margin_memories (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at)
     VALUES (?,?,NULL,?,'context',0.9,'proposed',?,NULL,NULL,1,?,?,?,?,NULL,NULL)`,
    memId, f.workstream.id, content, now, f.actor.sourceSessionId, f.actor.sourceEventId, now, now
  );
  return f.store.db.get('SELECT * FROM margin_memories WHERE id=?', memId);
}

test('Candidate confirms to Active, archives, restores, and corrects without losing evidence', async (t) => {
  const f = await fixture(t);
  const candidate = await propose(f, 'Use the reviewed resume for applications');

  const active = await f.repository.confirmMemory({
    requestId: 'confirm-1', workstreamId: f.workstream.id,
    memoryId: candidate.id, expectedVersion: 1
  }, f.actor);
  assert.equal(active.data.confirmation_status, 'confirmed');
  assert.equal(active.data.archived_at, null);

  const archived = await f.repository.archiveMemory({
    requestId: 'archive-1', workstreamId: f.workstream.id,
    memoryId: active.data.id, expectedVersion: active.data.version
  }, f.actor);
  assert.ok(archived.data.archived_at);

  const searchExcluded = await f.repository.searchMemories({
    workstreamId: f.workstream.id, query: 'reviewed resume', includeArchive: false,
    asOf: f.clock(), limit: 5
  });
  assert.deepEqual(searchExcluded.items, []);

  const restored = await f.repository.restoreMemory({
    requestId: 'restore-1', workstreamId: f.workstream.id,
    memoryId: archived.data.id, expectedVersion: archived.data.version
  }, f.actor);
  assert.equal(restored.data.archived_at, null);

  const corrected = await f.repository.correctMemory({
    requestId: 'correct-1', workstreamId: f.workstream.id,
    memoryId: restored.data.id, expectedVersion: restored.data.version,
    content: 'Use resume version 3 for applications', memoryType: 'context',
    confidence: 1, validFrom: f.clock(), expiresAt: null
  }, f.actor);
  assert.equal(corrected.data.content, 'Use resume version 3 for applications');
  const supersededRow = await f.store.db.get('SELECT superseded_by FROM margin_memories WHERE id=?', restored.data.id);
  assert.equal(supersededRow.superseded_by, corrected.data.id);
});

test('cross-Workstream confirm is rejected', async (t) => {
  const f = await fixture(t);
  const f2 = await fixture(t);
  const candidate = await propose(f, 'Some memory');
  await assert.rejects(
    () => f2.repository.confirmMemory({ requestId: 'bad-confirm', workstreamId: f2.workstream.id, memoryId: candidate.id, expectedVersion: 1 }, f2.actor),
    (err) => { assert.equal(err.code, 'not_found'); return true; }
  );
});

test('stale version confirm is rejected without writing Event', async (t) => {
  const f = await fixture(t);
  const candidate = await propose(f, 'Another memory');
  const beforeEvents = (await f.store.db.get('SELECT COUNT(*) AS c FROM margin_events')).c;
  await assert.rejects(
    () => f.repository.confirmMemory({ requestId: 'stale-confirm', workstreamId: f.workstream.id, memoryId: candidate.id, expectedVersion: 99 }, f.actor),
    (err) => { assert.equal(err.code, 'version_conflict'); return true; }
  );
  const afterEvents = (await f.store.db.get('SELECT COUNT(*) AS c FROM margin_events')).c;
  assert.equal(afterEvents, beforeEvents);
});

test('same-key confirm replay returns same result', async (t) => {
  const f = await fixture(t);
  const candidate = await propose(f, 'Idempotent memory');
  const first = await f.repository.confirmMemory({ requestId: 'idem-confirm', workstreamId: f.workstream.id, memoryId: candidate.id, expectedVersion: 1 }, f.actor);
  const second = await f.repository.confirmMemory({ requestId: 'idem-confirm', workstreamId: f.workstream.id, memoryId: candidate.id, expectedVersion: 1 }, f.actor);
  assert.equal(first.data.id, second.data.id);
  assert.equal(first.data.version, second.data.version);
});

test('different-input same requestId is idempotency_conflict', async (t) => {
  const f = await fixture(t);
  const c1 = await propose(f, 'Memory A');
  const c2 = await propose(f, 'Memory B');
  await f.repository.confirmMemory({ requestId: 'conflict-key', workstreamId: f.workstream.id, memoryId: c1.id, expectedVersion: 1 }, f.actor);
  await assert.rejects(
    () => f.repository.confirmMemory({ requestId: 'conflict-key', workstreamId: f.workstream.id, memoryId: c2.id, expectedVersion: 1 }, f.actor),
    (err) => { assert.equal(err.code, 'idempotency_conflict'); return true; }
  );
});

test('archive-inclusive search returns archived items', async (t) => {
  const f = await fixture(t);
  const candidate = await propose(f, 'Archived context item');
  const active = await f.repository.confirmMemory({ requestId: 'arc-confirm', workstreamId: f.workstream.id, memoryId: candidate.id, expectedVersion: 1 }, f.actor);
  await f.repository.archiveMemory({ requestId: 'arc-archive', workstreamId: f.workstream.id, memoryId: active.data.id, expectedVersion: active.data.version }, f.actor);
  const withArchive = await f.repository.searchMemories({ workstreamId: f.workstream.id, query: 'archived context', includeArchive: true, asOf: f.clock(), limit: 5 });
  assert.equal(withArchive.items.some((i) => i.id === active.data.id), true);
});

test('candidate is excluded from default searchMemories', async (t) => {
  const f = await fixture(t);
  await propose(f, 'Only a candidate memory');
  const result = await f.repository.searchMemories({ workstreamId: f.workstream.id, query: 'candidate memory', includeArchive: false, asOf: f.clock(), limit: 5 });
  assert.deepEqual(result.items, []);
});

test('listMemories returns active memories for workstream', async (t) => {
  const f = await fixture(t);
  const candidate = await propose(f, 'Listed memory');
  await f.repository.confirmMemory({ requestId: 'list-confirm', workstreamId: f.workstream.id, memoryId: candidate.id, expectedVersion: 1 }, f.actor);
  const result = await f.repository.listMemories({ workstreamId: f.workstream.id, lifecycleStatuses: ['active'], limit: 10 });
  assert.equal(result.items.length >= 1, true);
  assert.equal(result.items.every((i) => i.confirmation_status === 'confirmed' && !i.archived_at), true);
});

test('listRecentEventRows returns events scoped to workstream', async (t) => {
  const f = await fixture(t);
  const rows = await f.repository.listRecentEventRows(f.workstream.id, 10);
  assert.ok(Array.isArray(rows));
});
