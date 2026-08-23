import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';
import { createMarginApplicationContract } from '../src/application/marginApplicationContract.js';

function context(requestId, capabilities, overrides = {}) {
  return {
    actor: { type: 'user', subjectId: 'reader-1' }, surface: { kind: 'web', instanceId: 'web-1' },
    requestId, correlationId: 'read-correlation', capabilities, ...overrides
  };
}

const query = (type, requestId, payload = {}) => ({ type, requestId, payload });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-contract-queries-'));
  const dbPath = path.join(directory, 'core.sqlite');
  let number = 0;
  const options = {
    enabled: true, dbPath, clock: () => '2026-08-24T01:00:00.000Z',
    idFactory: (kind = 'id') => `${kind}-${++number}`
  };
  const core = await createMarginCore(options);
  return { core, options, dbPath, directory, async cleanup() { await core.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); } };
}

test('missing query and event capabilities are rejected before repository reads', async () => {
  let reads = 0;
  const repository = new Proxy({}, { get() { reads += 1; throw new Error('repository must not be read'); } });
  const gateway = createMarginApplicationContract({ services: {}, repository, runtimeControl: null, toActor: () => ({}) });
  const deniedQuery = await gateway.query(query('workstream.get', 'q-1', { workstreamId: 'w-1' }), context('q-1', []));
  const deniedEvent = await gateway.events(query('event.list', 'e-1', { afterCursor: 0 }), context('e-1', []));
  assert.equal(deniedQuery.error.code, 'capability_required');
  assert.equal(deniedEvent.error.code, 'capability_required');
  assert.equal(reads, 0);
});

test('null and primitive invocations return frozen invalid_request envelopes', async () => {
  const gateway = createMarginApplicationContract({ services: {}, repository: {}, toActor: () => ({}) });
  for (const invoke of [
    () => gateway.execute(null, null),
    () => gateway.query(1, 'context'),
    () => gateway.events(undefined, 2)
  ]) {
    const response = await invoke();
    assert.equal(response.error.code, 'invalid_request');
    assert.equal(Object.isFrozen(response), true);
  }
});

test('query routes return frozen DTOs and keep Decision reads distinct from NeedsOwner', async () => {
  const f = await fixture();
  try {
    const gateway = f.core.createApplicationContract({ runtimeControl: { async activate() {}, async halt() {} } });
    const workstream = (await gateway.execute(
      { type: 'workstream.create', requestId: 'create-w', idempotencyKey: 'create-w-key', payload: { title: 'Queries', goal: 'Read authority', scenario: 'learning_research' } },
      context('create-w', ['workstream:write'])
    )).data;
    const need = (await gateway.execute(
      { type: 'needs_owner.create', requestId: 'create-n', idempotencyKey: 'create-n-key', payload: { workstreamId: workstream.id, type: 'decision', reason: 'Pick one', options: [] } },
      context('create-n', ['needs_owner:write'])
    )).data;
    await f.core.store.db.run(
      `INSERT INTO margin_decisions
       (id,project_id,task_id,decision_key,content,status,effective_at,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at)
       VALUES ('decision-1',?,NULL,'release','Ship','confirmed',?,NULL,NULL,1,'session','event',?,?)`,
      workstream.id, f.options.clock(), f.options.clock(), f.options.clock()
    );

    const requests = [
      ['workstream.list', ['workstream:read'], {}],
      ['workstream.get', ['workstream:read'], { workstreamId: workstream.id }],
      ['run.list', ['run:read'], { workstreamId: workstream.id }],
      ['artifact.list', ['artifact:read'], { workstreamId: workstream.id }],
      ['decision.list', ['decision:read'], { workstreamId: workstream.id }],
      ['needs_owner.list', ['needs_owner:read'], { workstreamId: workstream.id }],
      ['checkpoint.latest', ['checkpoint:read'], { workstreamId: workstream.id }]
    ];
    const responses = new Map();
    for (const [type, capabilities, payload] of requests) {
      const requestId = `query-${type}`;
      const response = await gateway.query(query(type, requestId, payload), context(requestId, capabilities));
      assert.equal(response.ok, true, `${type}: ${JSON.stringify(response.error)}`);
      assert.equal(response.meta.requestId, requestId);
      assert.equal(Object.isFrozen(response), true);
      responses.set(type, response);
    }
    assert.equal(responses.get('decision.list').data.items[0].id, 'decision-1');
    assert.equal(responses.get('needs_owner.list').data.items[0].id, need.id);
    assert.notEqual(responses.get('decision.list').data.items[0].id, need.id);
    assert.equal(responses.get('checkpoint.latest').data, null);

    const missingRun = await gateway.query(query('run.get', 'run-get', { runId: 'missing' }), context('run-get', ['run:read']));
    assert.equal(missingRun.error.code, 'not_found');
    const unknown = await gateway.query(query('run.search', 'unknown', {}), context('unknown', ['run:read']));
    assert.equal(unknown.error.code, 'invalid_request');
  } finally { await f.cleanup(); }
});

test('restart queries return the same persisted DTO ids and versions', async () => {
  const f = await fixture();
  let current = f.core;
  try {
    let gateway = current.createApplicationContract({ runtimeControl: { async activate() {}, async halt() {} } });
    const workstream = (await gateway.execute(
      { type: 'workstream.create', requestId: 'create', idempotencyKey: 'create-key', payload: { title: 'Restart', goal: 'Keep identity', scenario: 'career_project' } },
      context('create', ['workstream:write'])
    )).data;
    const need = (await gateway.execute(
      { type: 'needs_owner.create', requestId: 'need', idempotencyKey: 'need-key', payload: { workstreamId: workstream.id, type: 'input', reason: 'Input required', options: [] } },
      context('need', ['needs_owner:write'])
    )).data;
    await current.close();
    current = await createMarginCore({ enabled: true, dbPath: f.dbPath, clock: f.options.clock });
    f.core = current;
    gateway = current.createApplicationContract({ runtimeControl: { async activate() {}, async halt() {} } });
    const reopenedWorkstream = await gateway.query(query('workstream.get', 'get-w', { workstreamId: workstream.id }), context('get-w', ['workstream:read']));
    const reopenedNeeds = await gateway.query(query('needs_owner.list', 'get-n', { workstreamId: workstream.id }), context('get-n', ['needs_owner:read']));
    assert.equal(reopenedWorkstream.data.id, workstream.id);
    assert.equal(reopenedWorkstream.data.version, workstream.version);
    assert.equal(reopenedNeeds.data.items[0].id, need.id);
    assert.equal(reopenedNeeds.data.items[0].version, need.version);
  } finally {
    await current.close().catch(() => {});
    f.core.close = async () => {};
    await f.cleanup();
  }
});
