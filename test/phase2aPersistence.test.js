import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

const actor = {
  actorType: 'user', subjectId: 'phase2a-user', sourceSessionId: 'phase2a-session', sourceEventId: 'phase2a-event'
};

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2a-'));
  const dbPath = path.join(directory, 'core.sqlite');
  let number = 0;
  const core = await createMarginCore({
    enabled: true,
    dbPath,
    clock: () => '2026-08-23T12:00:00.000Z',
    idFactory: (kind = 'id') => `${kind}-${++number}`,
    ...options
  });
  const workstream = (await core.workstreams.create({
    requestId: 'workstream-create', title: 'Phase 2A', goal: 'Ship persistence', scenario: 'career_project'
  }, actor)).data;
  return {
    core, dbPath, directory, workstream,
    async cleanup() { await core.close(); await rm(directory, { recursive: true, force: true }); }
  };
}

function needsOwnerInput(workstreamId, requestId = 'needs-owner-create') {
  return {
    requestId, workstreamId, type: 'approval', reason: 'Select the release path',
    options: [{ id: 'approve', label: 'Approve', consequenceSummary: 'Proceed' }],
    consequenceSummary: 'Release remains blocked', contextSummary: 'The checklist is ready'
  };
}

test('migration 004 adds contract fields, NeedsOwner, and a stable event sequence', async () => {
  const f = await fixture();
  try {
    const names = (await f.core.store.db.all("SELECT name FROM pragma_table_info('margin_projects')")).map((row) => row.name);
    assert.ok(names.includes('priority'));
    assert.ok(names.includes('current_state'));
    assert.ok(await f.core.store.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='margin_needs_owner'"));
    assert.ok(await f.core.store.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='margin_event_cursors'"));
  } finally { await f.cleanup(); }
});

test('NeedsOwner create commits state event audit and cursor atomically', async () => {
  const f = await fixture();
  try {
    const result = await f.core.repository.createNeedsOwner(needsOwnerInput(f.workstream.id), actor);
    assert.equal(result.data.status, 'open');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_needs_owner WHERE id=?', result.data.id)).count, 1);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events WHERE entity_id=?', result.data.id)).count, 1);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_event_cursors c JOIN margin_events e ON e.id=c.event_id WHERE e.entity_id=?', result.data.id)).count, 1);
    assert.ok(result.auditId);
  } finally { await f.cleanup(); }
});

test('NeedsOwner create replays the same request and rejects changed input or subject', async () => {
  const f = await fixture();
  try {
    const input = needsOwnerInput(f.workstream.id);
    const first = await f.core.repository.createNeedsOwner(input, actor);
    const replay = await f.core.repository.createNeedsOwner(input, actor);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(replay.auditId, first.auditId);
    await assert.rejects(
      f.core.repository.createNeedsOwner({ ...input, reason: 'Different reason' }, actor),
      (error) => error.code === 'idempotency_conflict'
    );
    await assert.rejects(
      f.core.repository.createNeedsOwner(input, { ...actor, subjectId: 'another-user' }),
      (error) => error.code === 'idempotency_conflict'
    );
  } finally { await f.cleanup(); }
});

test('NeedsOwner resolve rejects stale version without changing its state or evidence', async () => {
  const f = await fixture();
  try {
    const created = await f.core.repository.createNeedsOwner(needsOwnerInput(f.workstream.id), actor);
    const eventsBefore = await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events WHERE entity_id=?', created.data.id);
    await assert.rejects(
      f.core.repository.resolveNeedsOwner({ requestId: 'needs-owner-resolve', needsOwnerId: created.data.id, expectedVersion: 0, resolution: 'Approved' }, actor),
      (error) => error.code === 'version_conflict'
    );
    const row = await f.core.repository.getNeedsOwner(created.data.id);
    assert.equal(row.status, 'open');
    assert.equal(row.version, 1);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events WHERE entity_id=?', created.data.id)).count, eventsBefore.count);
  } finally { await f.cleanup(); }
});

test('NeedsOwner create rolls back its row when evidence fails', async () => {
  const f = await fixture({ beforeEvidenceWrite: async ({ entityType }) => {
    if (entityType === 'needs_owner') throw new Error('injected evidence failure');
  } });
  try {
    await assert.rejects(f.core.repository.createNeedsOwner(needsOwnerInput(f.workstream.id), actor));
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_needs_owner')).count, 0);
  } finally { await f.cleanup(); }
});

test('event cursors are monotonic at one timestamp and survive reopening the database', async () => {
  const f = await fixture();
  try {
    const one = await f.core.repository.createNeedsOwner(needsOwnerInput(f.workstream.id, 'one'), actor);
    const two = await f.core.repository.createNeedsOwner(needsOwnerInput(f.workstream.id, 'two'), actor);
    const before = await f.core.repository.listEventRows({ workstreamId: f.workstream.id, afterCursor: 0, limit: 100 });
    assert.deepEqual(before.items.map((row) => row.sequence), [...before.items.map((row) => row.sequence)].sort((a, b) => a - b));
    assert.equal(new Set(before.items.map((row) => row.event_id)).size, before.items.length);
    const firstPage = await f.core.repository.listEventRows({ workstreamId: f.workstream.id, afterCursor: 0, limit: 1 });
    const secondPage = await f.core.repository.listEventRows({ workstreamId: f.workstream.id, afterCursor: firstPage.nextCursor, limit: 100 });
    assert.deepEqual([...firstPage.items, ...secondPage.items].map((row) => row.sequence), before.items.map((row) => row.sequence));
    await f.core.close();
    const reopened = await createMarginCore({ enabled: true, dbPath: f.dbPath, clock: () => '2026-08-23T12:00:00.000Z' });
    const three = await reopened.repository.createNeedsOwner(needsOwnerInput(f.workstream.id, 'three'), actor);
    const cursor = await reopened.store.db.get('SELECT sequence FROM margin_event_cursors c JOIN margin_events e ON e.id=c.event_id WHERE e.entity_id=?', three.data.id);
    assert.ok(cursor.sequence > Math.max(...before.items.map((row) => row.sequence)));
    await reopened.close();
    f.core.close = async () => {};
    assert.ok(one.data.id && two.data.id);
  } finally { await f.cleanup(); }
});
