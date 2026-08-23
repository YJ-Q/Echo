import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

function context(requestId, capabilities) {
  return {
    actor: { type: 'user', subjectId: 'event-reader' },
    surface: { kind: 'web', instanceId: 'events-web' },
    requestId,
    correlationId: 'events-correlation',
    capabilities
  };
}

function command(type, requestId, idempotencyKey, payload, expectedVersion) {
  return { type, requestId, idempotencyKey, ...(expectedVersion === undefined ? {} : { expectedVersion }), payload };
}

function eventList(requestId, afterCursor = 0, limit = 50, extra = {}) {
  return { type: 'event.list', requestId, payload: { afterCursor, limit, ...extra } };
}

function activityList(requestId, workstreamId, afterCursor = 0, limit = 50) {
  return { type: 'activity.list', requestId, payload: { workstreamId, afterCursor, limit } };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-contract-events-'));
  const dbPath = path.join(directory, 'core.sqlite');
  let number = 0;
  const options = {
    enabled: true,
    dbPath,
    clock: () => '2026-08-24T02:00:00.000Z',
    idFactory: (kind = 'id') => `${kind}-${++number}`
  };
  let core = await createMarginCore(options);
  return {
    options, dbPath, directory,
    get core() { return core; },
    async restart() { await core.close(); core = await createMarginCore({ enabled: true, dbPath, clock: options.clock }); return core; },
    async cleanup() { await core.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
  };
}

async function createFourEvents(f) {
  let gateway = f.core.createApplicationContract({ runtimeControl: { async activate() {}, async halt() {} } });
  const workstream = (await gateway.execute(
    command('workstream.create', 'event-create-w', 'event-create-w-key', {
      title: 'Events', goal: 'Read safe envelopes', scenario: 'career_project'
    }),
    context('event-create-w', ['workstream:write'])
  )).data;
  const updated = await gateway.execute(
    command('workstream.update', 'event-update-w', 'event-update-w-key', {
      workstreamId: workstream.id, changes: { currentState: 'mapped' }
    }, workstream.version),
    context('event-update-w', ['workstream:write'])
  );
  const need = (await gateway.execute(
    command('needs_owner.create', 'event-create-n', 'event-create-n-key', {
      workstreamId: workstream.id, type: 'approval', reason: 'Approve event reader', options: []
    }),
    context('event-create-n', ['needs_owner:write'])
  )).data;
  const resolved = await gateway.execute(
    command('needs_owner.resolve', 'event-resolve-n', 'event-resolve-n-key', {
      needsOwnerId: need.id, resolutionSummary: 'Approved'
    }, need.version),
    context('event-resolve-n', ['needs_owner:resolve'])
  );
  return { gateway, workstream, updated: updated.data, need, resolved: resolved.data };
}

test('event cursor is monotonic, restart-stable, and paginates without gaps or duplicates', async () => {
  const f = await fixture();
  try {
    const { gateway: beforeRestart } = await createFourEvents(f);
    const first = await beforeRestart.events(eventList('event-page-1', 0, 2), context('event-page-1', ['event:read']));
    assert.equal(first.ok, true);
    assert.deepEqual(first.data.items.map((event) => event.cursor), [1, 2]);
    assert.equal(first.data.nextCursor, 2);

    const core = await f.restart();
    const afterRestart = core.createApplicationContract({ runtimeControl: { async activate() {}, async halt() {} } });
    const second = await afterRestart.events(eventList('event-page-2', first.data.nextCursor, 2), context('event-page-2', ['event:read']));
    const all = [...first.data.items, ...second.data.items];
    assert.deepEqual(all.map((event) => event.cursor), [1, 2, 3, 4]);
    assert.equal(new Set(all.map((event) => event.eventId)).size, 4);
    assert.equal(second.data.nextCursor, 4);
  } finally { await f.cleanup(); }
});

test('event envelopes whitelist aggregate identity and activity is a deterministic projection without a table', async () => {
  const f = await fixture();
  try {
    const { gateway, workstream, updated } = await createFourEvents(f);
    const events = await gateway.events(eventList('event-safe', 0, 50), context('event-safe', ['event:read']));
    const update = events.data.items.find((event) => event.eventType === 'workstream.updated');
    assert.deepEqual(Object.keys(update), [
      'cursor', 'eventId', 'eventType', 'aggregateType', 'aggregateId', 'aggregateVersion', 'workstreamId', 'runId',
      'occurredAt', 'actor', 'source', 'summary', 'data', 'contractVersion'
    ]);
    assert.equal(update.aggregateType, 'workstream');
    assert.equal(update.aggregateId, workstream.id);
    assert.equal(update.aggregateVersion, updated.version);
    assert.equal(update.workstreamId, workstream.id);
    assert.equal(update.runId, null);
    assert.deepEqual(update.actor, { type: 'user', subjectId: 'event-reader' });
    assert.deepEqual(update.source, { kind: 'application', surfaceKind: 'web', runtimeReference: null, correlationId: 'events-correlation' });
    assert.equal(update.summary, 'Workstream updated');
    assert.deepEqual(update.data, {});
    assert.equal(update.contractVersion, '1.0');
    assert.equal(Object.isFrozen(events), true);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['chainOfThought', 'prompt', 'runtime_session_id', 'apiKey', 'sessionObject', 'sourceSessionId', 'payload']) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    const activity = await gateway.query(activityList('activity-safe', workstream.id), context('activity-safe', ['activity:read']));
    assert.equal(activity.ok, true);
    assert.deepEqual(activity.data.items.map((item) => item.cursor), events.data.items.map((item) => item.cursor));
    assert.deepEqual(Object.keys(activity.data.items[0]), [
      'cursor', 'type', 'workstreamId', 'runId', 'title', 'summary', 'status', 'occurredAt', 'artifactReference', 'needsOwnerId'
    ]);
    assert.ok(activity.data.items.every((item) => typeof item.title === 'string' && item.title.length > 0 && typeof item.summary === 'string'));
    assert.equal(JSON.stringify(activity).includes('payload'), false);
    assert.equal((await f.core.store.db.get("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE '%activity%'")).count, 0);
  } finally { await f.cleanup(); }
});

test('event reads advance across unknown internal rows and mutation replay or conflicts do not append events', async () => {
  const f = await fixture();
  try {
    const { gateway, workstream } = await createFourEvents(f);
    const before = (await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count;
    await f.core.store.db.run(
      `INSERT INTO margin_events
       (id,entity_type,entity_id,project_id,event_type,entity_version,payload,source_session_id,source_event_id,created_at)
       VALUES ('internal-event','internal','internal-id',?,'updated',1,'{"prompt":"never expose"}','private-session','internal-request',?)`,
      workstream.id, f.options.clock()
    );
    const unknownCursor = (await f.core.store.db.get("SELECT sequence FROM margin_event_cursors WHERE event_id='internal-event'")).sequence;
    const page = await gateway.events(eventList('event-unknown', unknownCursor - 1, 1), context('event-unknown', ['event:read']));
    assert.deepEqual(page.data.items, []);
    assert.equal(page.data.nextCursor, unknownCursor);
    assert.deepEqual(page.data.diagnostics, { skippedUnknownEvents: 1 });

    await f.core.store.db.run(
      `INSERT INTO margin_events
       (id,entity_type,entity_id,project_id,event_type,entity_version,payload,source_session_id,source_event_id,created_at)
       VALUES ('malformed-event','internal','malformed-id',?,'updated',1,'{not json','private-session','malformed-request',?)`,
      workstream.id, f.options.clock()
    );
    const malformedCursor = (await f.core.store.db.get("SELECT sequence FROM margin_event_cursors WHERE event_id='malformed-event'")).sequence;
    const malformed = await gateway.events(eventList('event-malformed', malformedCursor - 1, 1), context('event-malformed', ['event:read']));
    assert.deepEqual(malformed.data.items, []);
    assert.equal(malformed.data.nextCursor, malformedCursor);
    assert.deepEqual(malformed.data.diagnostics, { skippedUnknownEvents: 1 });

    const first = await gateway.execute(
      command('needs_owner.create', 'event-replay-1', 'event-replay-key', {
        workstreamId: workstream.id, type: 'input', reason: 'One event', options: []
      }),
      context('event-replay-1', ['needs_owner:write'])
    );
    const countAfterFirst = (await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count;
    const replay = await gateway.execute(
      command('needs_owner.create', 'event-replay-2', 'event-replay-key', {
        workstreamId: workstream.id, type: 'input', reason: 'One event', options: []
      }),
      context('event-replay-2', ['needs_owner:write'])
    );
    assert.equal(replay.data.id, first.data.id);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, countAfterFirst);
    const conflict = await gateway.execute(
      command('needs_owner.create', 'event-conflict', 'event-conflict-key', {
        workstreamId: workstream.id, type: 'input', reason: 'Conflict', options: []
      }),
      context('event-conflict', ['needs_owner:write'])
    );
    const conflictRetry = await gateway.execute(
      command('needs_owner.create', 'event-conflict-2', 'event-conflict-key', {
        workstreamId: workstream.id, type: 'input', reason: 'Changed input', options: []
      }),
      context('event-conflict-2', ['needs_owner:write'])
    );
    assert.equal(conflict.ok, true);
    assert.equal(conflictRetry.error.code, 'idempotency_conflict');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, countAfterFirst + 1);
    assert.ok(before > 0);
  } finally { await f.cleanup(); }
});

test('empty event and activity pages preserve the supplied cursor', async () => {
  const f = await fixture();
  try {
    const { gateway, workstream } = await createFourEvents(f);
    const events = await gateway.events(eventList('event-empty', 99, 10), context('event-empty', ['event:read']));
    const activity = await gateway.query(activityList('activity-empty', workstream.id, 99, 10), context('activity-empty', ['activity:read']));
    assert.deepEqual(events.data.items, []);
    assert.equal(events.data.nextCursor, 99);
    assert.deepEqual(activity.data.items, []);
    assert.equal(activity.data.nextCursor, 99);
  } finally { await f.cleanup(); }
});

test('event reads do not duplicate an aggregate when historical evidence reuses a source event id', async () => {
  const f = await fixture();
  try {
    const { gateway, workstream } = await createFourEvents(f);
    const firstActor = {
      actorType: 'user', subjectId: 'direct-user-one', sourceSessionId: 'direct-session', sourceEventId: 'reused-source-event',
      correlationId: 'direct-correlation', surfaceKind: 'cli'
    };
    const created = await f.core.repository.createNeedsOwner({
      requestId: 'direct-needs-create', workstreamId: workstream.id, type: 'input', reason: 'Historical evidence', options: []
    }, firstActor);
    const secondActor = { ...firstActor, subjectId: 'direct-user-two' };
    await f.core.repository.resolveNeedsOwner({
      requestId: 'direct-needs-resolve', needsOwnerId: created.data.id, expectedVersion: created.data.version, resolution: 'Recorded'
    }, secondActor);
    const events = await gateway.events(eventList('event-direct-history', 0, 50, { workstreamId: workstream.id }), context('event-direct-history', ['event:read']));
    const directEvents = events.data.items.filter((event) => event.aggregateId === created.data.id);
    assert.equal(directEvents.length, 2);
    assert.deepEqual(directEvents.map((event) => event.actor.subjectId), ['direct-user-one', 'direct-user-two']);
  } finally { await f.cleanup(); }
});

test('event actor is anonymous unless audit identity, aggregate scope, project scope, and operation all match', async () => {
  const f = await fixture();
  try {
    const { gateway, workstream } = await createFourEvents(f);
    const now = f.options.clock();
    const forged = [
      { id: 'forged-entity', entityId: 'other-workstream', projectId: workstream.id, operation: 'workstream_update' },
      { id: 'forged-project', entityId: workstream.id, projectId: 'other-project', operation: 'workstream_update' },
      { id: 'forged-operation', entityId: workstream.id, projectId: workstream.id, operation: 'run_start' }
    ];
    for (const [index, audit] of forged.entries()) {
      await f.core.store.db.run(
        `INSERT INTO margin_audit_log
         (id,operation,request_id,actor_type,project_id,entity_type,entity_id,permission_decision,result_code,input_digest,metadata,created_at)
         VALUES (?,?,?,'agent',?,'workstream',?,'allowed','allowed','digest',?,?)`,
        audit.id, audit.operation, `forged-request-${index}`, audit.projectId, audit.entityId,
        JSON.stringify({ actorSubjectId: `forged-subject-${index}` }), now
      );
      await f.core.store.db.run(
        `INSERT INTO margin_events
         (id,entity_type,entity_id,project_id,event_type,entity_version,payload,source_session_id,source_event_id,created_at)
         VALUES (?,'workstream',?,?,'updated',9,?,'private','forged',?)`,
        `forged-event-${index}`, workstream.id, workstream.id,
        JSON.stringify({ command: 'workstream_update', status: 'running', correlationId: 'forged-correlation', surfaceKind: 'web', auditId: audit.id }), now
      );
    }
    const events = await gateway.events(eventList('event-forged-audit', 0, 50, { workstreamId: workstream.id }), context('event-forged-audit', ['event:read']));
    const forgedEvents = events.data.items.filter((event) => event.eventId.startsWith('forged-event-'));
    assert.equal(forgedEvents.length, 3);
    for (const event of forgedEvents) assert.deepEqual(event.actor, { type: null, subjectId: null });
  } finally { await f.cleanup(); }
});
