import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMarginCore } from '../src/core/createMarginCore.js';

function context(requestId, capabilities) {
  return {
    actor: { type: 'user', subjectId: 'phase-2a-owner' },
    surface: { kind: 'cli', instanceId: 'phase-2a-e2e' },
    requestId,
    correlationId: 'phase-2a-restart-flow',
    capabilities
  };
}

function command(type, requestId, payload, expectedVersion) {
  return {
    type,
    requestId,
    idempotencyKey: `${requestId}-intent`,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    payload
  };
}

function query(type, requestId, payload) {
  return { type, requestId, payload };
}

function requireSuccess(response) {
  assert.equal(response.ok, true, JSON.stringify(response.error));
  return response.data;
}

test('one canonical Core survives command event cursor and CLI restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2a-e2e-'));
  const dbPath = path.join(directory, 'margin-core.sqlite');
  const coreOptions = { enabled: true, dbPath };
  const runtimeCalls = [];
  const runtimeControl = {
    async activate(run) {
      const runtimeSessionId = run.runtime_session_id ?? `runtime-${run.id}`;
      runtimeCalls.push({ operation: 'activate', runId: run.id, runtimeSessionId });
      return { runtimeSessionId };
    },
    async halt(run) {
      runtimeCalls.push({ operation: 'halt', runId: run.id, runtimeSessionId: run.runtime_session_id });
    }
  };
  let core = null;

  const execute = async (gateway, value, capabilities, { host = false } = {}) => {
    const rawContext = context(value.requestId, capabilities);
    return gateway.execute(value, host ? core.bindHostContext(rawContext) : rawContext);
  };
  const read = (gateway, value, capabilities) => gateway.query(value, context(value.requestId, capabilities));

  try {
    core = await createMarginCore(coreOptions);
    let gateway = core.createApplicationContract({ runtimeControl });
    const workstream = requireSuccess(await execute(gateway, command('workstream.create', 'create-workstream', {
      title: 'Phase 2A acceptance',
      goal: 'Prove one persistent application contract',
      scenario: 'career_project',
      priority: 2,
      currentPlan: ['exercise the canonical lifecycle'],
      nextAction: 'start the Run'
    }), ['workstream:write']));
    let run = requireSuccess(await execute(gateway, command('run.create', 'create-run', {
      workstreamId: workstream.id,
      workerKind: 'pi',
      scope: 'Complete the restart acceptance path',
      stopCondition: 'acceptance complete',
      allowedActions: ['read', 'write'],
      forbiddenActions: ['external_write']
    }), ['run:control'], { host: true }));
    run = requireSuccess(await execute(
      gateway,
      command('run.start', 'start-run', { runId: run.id }, run.version),
      ['run:control'],
      { host: true }
    ));
    const startedRuntimeReference = run.runtimeReference;

    const artifact = requireSuccess(await execute(gateway, command('artifact.create', 'create-artifact', {
      workstreamId: workstream.id,
      runId: run.id,
      type: 'report',
      title: 'Phase 2A evidence',
      resourceReference: { uri: 'margin://artifact/phase-2a-evidence', contentHash: 'phase-2a-hash' },
      metadata: { format: 'markdown' },
      previewMetadata: { lineCount: 12 }
    }), ['artifact:write']));
    const explicitCheckpoint = requireSuccess(await execute(gateway, command('checkpoint.create', 'create-checkpoint', {
      workstreamId: workstream.id,
      runId: run.id,
      runVersion: run.version,
      stateVersion: workstream.version,
      stateDigest: 'phase-2a-state-digest',
      gitRef: '1858e29',
      note: 'before restart'
    }), ['checkpoint:write']));
    const needsOwner = requireSuccess(await execute(gateway, command('needs_owner.create', 'create-needs-owner', {
      workstreamId: workstream.id,
      runId: run.id,
      type: 'approval',
      reason: 'Approve the final transition',
      options: [{ id: 'approve', label: 'Approve', consequenceSummary: 'Resume and stop the Run' }],
      consequenceSummary: 'The Run remains paused until approval',
      contextSummary: 'Restart evidence is ready'
    }), ['needs_owner:write']));
    run = requireSuccess(await execute(
      gateway,
      command('run.pause', 'pause-run', { runId: run.id }, run.version),
      ['run:control'],
      { host: true }
    ));
    const beforeRestartWorkstream = requireSuccess(await read(
      gateway,
      query('workstream.get', 'get-workstream-before-restart', { workstreamId: workstream.id }),
      ['workstream:read']
    ));
    const pausedRun = run;
    assert.notEqual(pausedRun.checkpoint.id, explicitCheckpoint.id);
    assert.equal(pausedRun.checkpoint.runVersion, pausedRun.version);
    assert.equal(pausedRun.checkpoint.stateVersion, workstream.version);
    assert.equal((await core.store.db.get('SELECT COUNT(*) count FROM margin_checkpoints WHERE run_id=?', run.id)).count, 2);

    await core.close();
    core = await createMarginCore(coreOptions);
    gateway = core.createApplicationContract({ runtimeControl });

    const reopenedWorkstream = requireSuccess(await read(
      gateway,
      query('workstream.get', 'get-workstream-after-restart', { workstreamId: workstream.id }),
      ['workstream:read']
    ));
    const reopenedRun = requireSuccess(await read(
      gateway,
      query('run.get', 'get-run-after-restart', { runId: pausedRun.id }),
      ['run:read']
    ));
    const reopenedArtifacts = requireSuccess(await read(
      gateway,
      query('artifact.list', 'list-artifacts-after-restart', { workstreamId: workstream.id, runId: pausedRun.id }),
      ['artifact:read']
    ));
    const reopenedCheckpoint = requireSuccess(await read(
      gateway,
      query('checkpoint.latest', 'get-checkpoint-after-restart', { workstreamId: workstream.id, runId: pausedRun.id }),
      ['checkpoint:read']
    ));
    const reopenedNeedsOwner = requireSuccess(await read(
      gateway,
      query('needs_owner.list', 'list-needs-owner-after-restart', { workstreamId: workstream.id, runId: pausedRun.id }),
      ['needs_owner:read']
    ));

    assert.deepEqual(reopenedWorkstream, beforeRestartWorkstream);
    assert.equal(reopenedRun.id, pausedRun.id);
    assert.equal(reopenedRun.version, pausedRun.version);
    assert.deepEqual(reopenedRun.runtimeReference, startedRuntimeReference);
    assert.deepEqual(reopenedRun.checkpoint, pausedRun.checkpoint);
    assert.deepEqual(reopenedArtifacts.items, [artifact]);
    assert.deepEqual(reopenedCheckpoint, pausedRun.checkpoint);
    assert.deepEqual(reopenedNeedsOwner.items, [needsOwner]);
    assert.equal((await core.store.db.get('SELECT id FROM margin_checkpoints WHERE id=?', explicitCheckpoint.id)).id, explicitCheckpoint.id);

    run = requireSuccess(await execute(
      gateway,
      command('run.resume', 'resume-run', { runId: reopenedRun.id }, reopenedRun.version),
      ['run:control'],
      { host: true }
    ));
    const resolvedNeedsOwner = requireSuccess(await execute(
      gateway,
      command('needs_owner.resolve', 'resolve-needs-owner', {
        needsOwnerId: needsOwner.id,
        optionId: 'approve',
        resolutionSummary: 'Approved after restart'
      }, needsOwner.version),
      ['needs_owner:resolve']
    ));
    run = requireSuccess(await execute(
      gateway,
      command('run.stop', 'stop-run', { runId: run.id }, run.version),
      ['run:control'],
      { host: true }
    ));

    assert.equal(run.status, 'cancelled');
    assert.equal(run.version, 5);
    assert.deepEqual(run.runtimeReference, startedRuntimeReference);
    assert.equal(resolvedNeedsOwner.status, 'resolved');
    assert.equal(resolvedNeedsOwner.version, 2);
    assert.equal((await core.store.db.get('SELECT COUNT(*) count FROM margin_decisions')).count, 0);

    const eventRequest = query('event.list', 'list-events', {
      workstreamId: workstream.id,
      afterCursor: 0,
      limit: 100
    });
    const events = requireSuccess(await gateway.events(eventRequest, context(eventRequest.requestId, ['event:read'])));
    const activity = requireSuccess(await read(
      gateway,
      query('activity.list', 'list-activity', { workstreamId: workstream.id, afterCursor: 0, limit: 100 }),
      ['activity:read']
    ));
    const eventCursors = events.items.map((event) => event.cursor);

    assert.deepEqual(events.items.map((event) => event.eventType), [
      'workstream.created',
      'run.created',
      'run.started',
      'artifact.created',
      'checkpoint.created',
      'needs_owner.created',
      'run.paused',
      'run.resumed',
      'needs_owner.resolved',
      'run.stopped'
    ]);
    assert.equal(new Set(eventCursors).size, eventCursors.length);
    assert.equal(eventCursors.every((cursor, index) => index === 0 || cursor > eventCursors[index - 1]), true);
    assert.equal(new Set(events.items.map((event) => event.eventId)).size, events.items.length);
    assert.equal(events.nextCursor, eventCursors.at(-1));
    assert.deepEqual(activity.items.map((item) => item.cursor), eventCursors);
    assert.deepEqual(activity.items.map((item) => item.type), events.items.map((event) => event.eventType));
    assert.equal(activity.nextCursor, events.nextCursor);
    assert.equal((await core.store.db.get("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND lower(name) LIKE '%activity%' ")).count, 0);
    assert.equal((await core.store.db.get('SELECT COUNT(*) count FROM margin_event_cursors')).count,
      (await core.store.db.get('SELECT COUNT(*) count FROM margin_events')).count);
    assert.deepEqual(runtimeCalls, [
      { operation: 'activate', runId: run.id, runtimeSessionId: startedRuntimeReference.id },
      { operation: 'halt', runId: run.id, runtimeSessionId: startedRuntimeReference.id },
      { operation: 'activate', runId: run.id, runtimeSessionId: startedRuntimeReference.id },
      { operation: 'halt', runId: run.id, runtimeSessionId: startedRuntimeReference.id }
    ]);
  } finally {
    if (core) await core.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
