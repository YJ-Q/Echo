import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

const runtimeControl = {
  calls: [],
  async activate(run) { this.calls.push(`activate:${run.id}`); return { runtimeSessionId: `runtime-${run.id}` }; },
  async halt(run) { this.calls.push(`halt:${run.id}`); }
};

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-contract-commands-'));
  let number = 0;
  const core = await createMarginCore({
    enabled: true,
    dbPath: path.join(directory, 'core.sqlite'),
    clock: () => '2026-08-24T00:00:00.000Z',
    idFactory: (kind = 'id') => `${kind}-${++number}`
  });
  runtimeControl.calls = [];
  const gateway = core.createApplicationContract({ runtimeControl });
  return { core, gateway, directory, async cleanup() { await core.close(); await rm(directory, { recursive: true, force: true }); } };
}

function context(requestId, capabilities, overrides = {}) {
  return {
    actor: { type: 'user', subjectId: 'owner-1' },
    surface: { kind: 'cli', instanceId: 'terminal-1' },
    requestId,
    correlationId: 'correlation-1',
    capabilities,
    ...overrides
  };
}

function command(type, requestId, idempotencyKey, payload, expectedVersion) {
  return { type, requestId, idempotencyKey, ...(expectedVersion === undefined ? {} : { expectedVersion }), payload };
}

async function executeHost(f, value, capabilities) {
  const trusted = f.core.bindHostContext(context(value.requestId, capabilities));
  return f.gateway.execute(value, trusted);
}

test('all command routes return frozen stable envelopes and NeedsOwner resolve creates no Decision', async () => {
  const f = await fixture();
  try {
    let response = await f.gateway.execute(
      command('workstream.create', 'call-w', 'business-w', {
        title: 'Phase 2A', goal: 'Ship the gateway', scenario: 'career_project', currentPlan: ['test first'],
        workspaceReference: { kind: 'local_path', path: 'D:/Echo' }
      }),
      context('call-w', ['workstream:write'])
    );
    assert.equal(response.ok, true);
    assert.equal(response.meta.requestId, 'call-w');
    assert.equal(response.meta.correlationId, 'correlation-1');
    assert.equal(response.meta.contractVersion, '1.0');
    assert.equal(Object.isFrozen(response), true);
    const workstream = response.data;

    response = await f.gateway.execute(
      command('workstream.update', 'call-update', 'business-update', { workstreamId: workstream.id, changes: { currentState: 'green' } }, workstream.version),
      context('call-update', ['workstream:write'])
    );
    assert.equal(response.data.version, 2);
    let updated = response.data;

    response = await executeHost(f,
      command('run.create', 'call-run', 'business-run', { workstreamId: workstream.id, workerKind: 'pi', scope: 'Implement Task 3' }),
      ['run:control']
    );
    let run = response.data;
    assert.equal(run.workerKind, 'pi');

    response = await f.gateway.execute(
      command('workstream.update', 'call-update-active', 'business-update-active', { workstreamId: workstream.id, changes: { currentState: 'run queued' } }, updated.version),
      context('call-update-active', ['workstream:write'])
    );
    assert.equal(response.data.activeRun.id, run.id);
    updated = response.data;

    response = await executeHost(f, command('run.start', 'call-start', 'business-start', { runId: run.id }, run.version), ['run:control']);
    run = response.data;
    assert.equal(run.status, 'running');
    const invalidStart = await executeHost(f,
      command('run.start', 'call-start-again', 'business-start-again', { runId: run.id }, run.version),
      ['run:control']
    );
    assert.equal(invalidStart.error.code, 'invalid_transition');
    assert.equal(invalidStart.error.retryable, false);

    response = await f.gateway.execute(
      command('artifact.create', 'call-artifact', 'business-artifact', {
        workstreamId: workstream.id, runId: run.id, type: 'report', title: 'Task 3 report',
        resourceReference: { uri: 'margin://artifact/task-3', contentHash: 'hash-1' }, metadata: { format: 'markdown' }
      }),
      context('call-artifact', ['artifact:write'])
    );
    assert.equal(response.data.resourceReference.contentHash, 'hash-1');

    response = await f.gateway.execute(
      command('checkpoint.create', 'call-checkpoint', 'business-checkpoint', {
        workstreamId: workstream.id, runId: run.id, runVersion: run.version,
        stateVersion: updated.version, stateDigest: 'digest-1', note: 'safe point'
      }),
      context('call-checkpoint', ['checkpoint:write'])
    );
    assert.equal(response.data.runVersion, run.version);

    response = await f.gateway.execute(
      command('needs_owner.create', 'call-need', 'business-need', {
        workstreamId: workstream.id, runId: run.id, type: 'approval', reason: 'Choose release path',
        options: [{ id: 'approve', label: 'Approve' }]
      }),
      context('call-need', ['needs_owner:write'])
    );
    const needsOwner = response.data;
    response = await f.gateway.execute(
      command('needs_owner.resolve', 'call-resolve', 'business-resolve', {
        needsOwnerId: needsOwner.id, optionId: 'approve', resolutionSummary: 'Approved'
      }, needsOwner.version),
      context('call-resolve', ['needs_owner:resolve'])
    );
    assert.equal(response.data.status, 'resolved');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_decisions')).count, 0);

    response = await executeHost(f, command('run.pause', 'call-pause', 'business-pause', { runId: run.id }, run.version), ['run:control']);
    run = response.data;
    assert.ok(run.checkpoint);
    response = await executeHost(f, command('run.resume', 'call-resume', 'business-resume', { runId: run.id }, run.version), ['run:control']);
    run = response.data;
    response = await executeHost(f, command('run.stop', 'call-stop', 'business-stop', { runId: run.id }, run.version), ['run:control']);
    assert.equal(response.data.status, 'cancelled');
  } finally { await f.cleanup(); }
});

test('same idempotencyKey replays run.create without a second Run or event when Gateway requestId changes', async () => {
  const f = await fixture();
  try {
    const created = await f.gateway.execute(
      command('workstream.create', 'w-call', 'w-key', { title: 'Replay', goal: 'One side effect', scenario: 'learning_research' }),
      context('w-call', ['workstream:write'])
    );
    const firstCommand = command('run.create', 'call-1', 'stable-run-key', { workstreamId: created.data.id, workerKind: 'pi', scope: 'One run' });
    const firstContext = f.core.bindHostContext(context('call-1', ['run:control']));
    const first = await f.gateway.execute(firstCommand, firstContext);
    const retryCommand = { ...firstCommand, requestId: 'call-2' };
    const retry = await f.gateway.execute(retryCommand, { ...firstContext, requestId: 'call-2' });
    assert.equal(retry.data.id, first.data.id);
    assert.equal(retry.meta.requestId, 'call-2');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_runs')).count, 1);
    const started = await f.gateway.execute(
      command('run.start', 'call-start', 'stable-start-key', { runId: first.data.id }, first.data.version),
      { ...firstContext, requestId: 'call-start' }
    );
    assert.equal(started.data.status, 'running');
    const paused = await f.gateway.execute(
      command('run.pause', 'call-pause', 'stable-pause-key', { runId: first.data.id }, started.data.version),
      { ...firstContext, requestId: 'call-pause' }
    );
    assert.ok(paused.data.checkpoint);
    const lateRetry = await f.gateway.execute(
      { ...firstCommand, requestId: 'call-3' },
      { ...firstContext, requestId: 'call-3' }
    );
    assert.deepEqual(lateRetry.data, first.data);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events WHERE entity_id=?', first.data.id)).count, 3);
    const audit = await f.core.store.db.get("SELECT request_id,metadata FROM margin_audit_log WHERE entity_id=? AND operation='run_create'", first.data.id);
    const event = await f.core.store.db.get('SELECT source_event_id FROM margin_events WHERE entity_id=?', first.data.id);
    assert.equal(audit.request_id, 'stable-run-key');
    const { replayData, replayRelated, ...auditMetadata } = JSON.parse(audit.metadata);
    assert.deepEqual(auditMetadata, {
      actorSubjectId: 'owner-1', correlationId: 'correlation-1', surfaceKind: 'cli', gatewayRequestId: 'call-1'
    });
    assert.equal(replayData.id, first.data.id);
    assert.equal(replayData.version, first.data.version);
    assert.deepEqual(replayRelated, { checkpoint: null });
    assert.equal(event.source_event_id, 'call-1');
  } finally { await f.cleanup(); }
});

test('stale workstream update and stale checkpoint tokens return version_conflict without state or event writes', async () => {
  const f = await fixture();
  try {
    const created = await f.gateway.execute(
      command('workstream.create', 'create', 'create-key', { title: 'Versions', goal: 'Reject stale writes', scenario: 'career_project' }),
      context('create', ['workstream:write'])
    );
    const current = await f.gateway.execute(
      command('workstream.update', 'advance', 'advance-key', { workstreamId: created.data.id, changes: { currentState: 'v2' } }, created.data.version),
      context('advance', ['workstream:write'])
    );
    const beforeEvents = (await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count;
    const conflict = await f.gateway.execute(
      command('workstream.update', 'stale', 'stale-key', { workstreamId: created.data.id, changes: { goal: 'Must not persist' } }, created.data.version),
      context('stale', ['workstream:write'])
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, 'version_conflict');
    assert.equal((await f.core.repository.getWorkstream(created.data.id)).goal, created.data.goal);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, beforeEvents);

    const staleCheckpoint = await f.gateway.execute(
      command('checkpoint.create', 'checkpoint-stale', 'checkpoint-stale-key', {
        workstreamId: created.data.id, stateVersion: 0, stateDigest: 'digest'
      }),
      context('checkpoint-stale', ['checkpoint:write'])
    );
    assert.equal(staleCheckpoint.error.code, 'version_conflict');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_checkpoints')).count, 0);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, beforeEvents);
    assert.equal(current.data.version, 2);
  } finally { await f.cleanup(); }
});

test('Run control rejects missing capability, serializable authority forgeries, and scheduler-shaped callers', async () => {
  const f = await fixture();
  try {
    const created = await f.gateway.execute(
      command('workstream.create', 'w', 'w-key', { title: 'Authority', goal: 'Keep private', scenario: 'career_project' }),
      context('w', ['workstream:write'])
    );
    const runCommand = command('run.create', 'run', 'run-key', { workstreamId: created.data.id, workerKind: 'pi', scope: 'Private control' });
    const missing = await f.gateway.execute(runCommand, context('run', []));
    assert.equal(missing.error.code, 'capability_required');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_runs')).count, 0);

    for (const forged of [
      context('run', ['run:control'], { hostAuthority: true }),
      context('run', ['run:control']),
      JSON.parse(JSON.stringify(f.core.bindHostContext(context('run', ['run:control'])))),
      context('run', ['run:control'], { actor: { type: 'user', subjectId: 'owner-1', actorType: 'user' } })
    ]) {
      const result = await f.gateway.execute(runCommand, forged);
      assert.equal(result.error.code, forged.actor.actorType ? 'invalid_request' : 'permission_denied');
    }

    const trustedRun = await executeHost(f, { ...runCommand, requestId: 'trusted-run', idempotencyKey: 'trusted-run-key' }, ['run:control']);
    const scheduler = context('scheduler-start', ['run:control'], {
      actor: { type: 'system', subjectId: 'scheduler-1' }, surface: { kind: 'scheduler', instanceId: 'daily' }
    });
    const denied = await f.gateway.execute(
      command('run.start', 'scheduler-start', 'scheduler-key', { runId: trustedRun.data.id }, trustedRun.data.version),
      scheduler
    );
    assert.equal(denied.error.code, 'permission_denied');
    assert.equal((await f.core.repository.getRun(trustedRun.data.id)).status, 'queued');
    assert.deepEqual(runtimeControl.calls, []);
  } finally { await f.cleanup(); }
});

test('stale checkpoint runVersion is transactionally rejected without checkpoint or event writes', async () => {
  const f = await fixture();
  try {
    const workstream = (await f.gateway.execute(
      command('workstream.create', 'run-version-w', 'run-version-w-key', { title: 'Run token', goal: 'Verify both tokens', scenario: 'career_project' }),
      context('run-version-w', ['workstream:write'])
    )).data;
    let run = (await executeHost(f,
      command('run.create', 'run-version-r', 'run-version-r-key', { workstreamId: workstream.id, workerKind: 'pi', scope: 'Advance version' }),
      ['run:control']
    )).data;
    const staleVersion = run.version;
    run = (await executeHost(f,
      command('run.start', 'run-version-start', 'run-version-start-key', { runId: run.id }, run.version),
      ['run:control']
    )).data;
    const eventsBefore = (await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count;
    const conflict = await f.gateway.execute(
      command('checkpoint.create', 'run-version-c', 'run-version-c-key', {
        workstreamId: workstream.id, runId: run.id, runVersion: staleVersion,
        stateVersion: workstream.version, stateDigest: 'digest'
      }),
      context('run-version-c', ['checkpoint:write'])
    );
    assert.equal(conflict.error.code, 'version_conflict');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_checkpoints')).count, 0);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, eventsBefore);
  } finally { await f.cleanup(); }
});

test('unknown command type and unexpected storage errors use safe stable envelopes', async () => {
  const f = await fixture();
  try {
    const unknown = await f.gateway.execute(
      command('run.launch', 'unknown', 'unknown-key', { runId: 'run-1' }),
      context('unknown', ['run:control'])
    );
    assert.equal(unknown.error.code, 'invalid_request');
    assert.equal(unknown.error.retryable, false);

    const original = f.core.repository.createArtifact;
    f.core.repository.createArtifact = async () => { throw new Error('SQL secret at D:/private.sqlite'); };
    const failed = await f.gateway.execute(
      command('artifact.create', 'storage', 'storage-key', {
        workstreamId: 'w-1', type: 'report', title: 'Report',
        resourceReference: { uri: 'margin://report', contentHash: 'hash' }
      }),
      context('storage', ['artifact:write'])
    );
    f.core.repository.createArtifact = original;
    assert.deepEqual(failed.error, { code: 'storage_failure', retryable: true });
    assert.equal(JSON.stringify(failed).includes('private.sqlite'), false);
  } finally { await f.cleanup(); }
});

test('NeedsOwner service rejects malformed options before any state or evidence write', async () => {
  const f = await fixture();
  try {
    const workstream = (await f.core.workstreams.create({
      requestId: 'direct-workstream', title: 'NeedsOwner', goal: 'Validate service input', scenario: 'career_project'
    }, { actorType: 'user', subjectId: 'owner-1', sourceSessionId: 'host', sourceEventId: 'call' })).data;
    const before = (await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count;
    await assert.rejects(
      f.core.needsOwner.create({
        requestId: 'bad-needs-owner', workstreamId: workstream.id, type: 'approval', reason: 'Choose',
        options: [{ id: '', label: 'Broken' }]
      }, { actorType: 'user', subjectId: 'owner-1', sourceSessionId: 'host', sourceEventId: 'call' }),
      (error) => error.code === 'invalid_request'
    );
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_needs_owner')).count, 0);
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, before);
  } finally { await f.cleanup(); }
});

test('one business idempotency key cannot be reused for a different command type', async () => {
  const f = await fixture();
  try {
    const workstream = await f.gateway.execute(
      command('workstream.create', 'create-call', 'shared-business-key', { title: 'Key scope', goal: 'Reject command drift', scenario: 'career_project' }),
      context('create-call', ['workstream:write'])
    );
    const conflict = await f.gateway.execute(
      command('needs_owner.create', 'needs-call', 'shared-business-key', {
        workstreamId: workstream.data.id, type: 'input', reason: 'Different command', options: []
      }),
      context('needs-call', ['needs_owner:write'])
    );
    assert.equal(conflict.error.code, 'idempotency_conflict');
    assert.equal((await f.core.store.db.get('SELECT COUNT(*) count FROM margin_needs_owner')).count, 0);
  } finally { await f.cleanup(); }
});
