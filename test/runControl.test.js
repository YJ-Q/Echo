import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

const actor = { actorType: 'user', subjectId: 'test-user', sourceSessionId: 'host', sourceEventId: 'event' };

test('run controls persist checkpoints across restart without ghost runtime', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-control-'));
  const dbPath = path.join(directory, 'core.sqlite');
  const calls = [];
  const runtimeControl = {
    async activate(run) { calls.push(`activate:${run.id}`); return { runtimeSessionId: 'runtime-1' }; },
    async halt(run) { calls.push(`halt:${run.id}`); }
  };
  let core = await createMarginCore({ enabled: true, dbPath, clock: () => '2026-08-23T12:00:00.000Z' });
  try {
    let hostActor = core.bindHostActor(actor);
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    let run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '验证控制', runtimeKind: 'pi' }, hostActor)).data;
    run = (await core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: run.version }, hostActor, runtimeControl)).data;
    assert.equal(run.status, 'running');
    const replayedStart = (await core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: 1 }, hostActor, runtimeControl)).data;
    assert.equal(replayedStart.id, run.id);
    assert.deepEqual(calls, [`activate:${run.id}`]);
    run = (await core.runs.pause({ requestId: 'pause', runId: run.id, expectedVersion: run.version }, hostActor, runtimeControl)).data;
    assert.equal(run.status, 'paused');
    assert.ok(run.checkpoint_id);
    assert.equal((await core.checkpoints.latest(run.id)).id, run.checkpoint_id);
    await core.close();
    core = await createMarginCore({ enabled: true, dbPath, clock: () => '2026-08-23T12:01:00.000Z' });
    hostActor = core.bindHostActor(actor);
    assert.equal((await core.runs.get(run.id)).status, 'paused');
    run = (await core.runs.resume({ requestId: 'resume', runId: run.id, expectedVersion: run.version }, hostActor, runtimeControl)).data;
    run = (await core.runs.stop({ requestId: 'stop', runId: run.id, expectedVersion: run.version }, hostActor, runtimeControl)).data;
    assert.equal(run.status, 'cancelled');
    assert.deepEqual(calls, [`activate:${run.id}`, `halt:${run.id}`, `activate:${run.id}`, `halt:${run.id}`]);
  } finally {
    await core.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed runtime activation leaves a run queued', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-control-fail-'));
  const core = await createMarginCore({ enabled: true, dbPath: path.join(directory, 'core.sqlite') });
  try {
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    const hostActor = core.bindHostActor(actor);
    const run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '验证失败', runtimeKind: 'pi' }, hostActor)).data;
    await assert.rejects(core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: 1 }, hostActor, { async activate() { throw new Error('offline'); }, async halt() {} }), /offline/);
    assert.equal((await core.runs.get(run.id)).status, 'queued');
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
});

test('persistence failure after activation rolls back SQLite without invalidating same-key Runtime retry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-control-compensate-'));
  let rejectRunEvidence = false;
  const core = await createMarginCore({
    enabled: true,
    dbPath: path.join(directory, 'core.sqlite'),
    beforeEvidenceWrite({ entityType }) {
      if (rejectRunEvidence && entityType === 'run') throw new Error('evidence unavailable');
    }
  });
  const calls = [];
  try {
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    const hostActor = core.bindHostActor(actor);
    const run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '补偿启动', runtimeKind: 'pi' }, hostActor)).data;
    rejectRunEvidence = true;
    await assert.rejects(
      core.runs.start(
        { requestId: 'start', runId: run.id, expectedVersion: run.version },
        hostActor,
        {
          async activate(value) { calls.push(`activate:${value.id}`); return { runtimeSessionId: 'runtime-compensate' }; },
          async halt(value) { calls.push(`halt:${value.id}`); }
        }
      ),
      /evidence unavailable/
    );
    assert.deepEqual(calls, [`activate:${run.id}`]);
    assert.equal((await core.runs.get(run.id)).status, 'queued');
    assert.equal((await core.store.db.get("SELECT COUNT(*) count FROM margin_audit_log WHERE operation='run_start'")).count, 0);
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
});

test('agent and system actors cannot control Runs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-control-auth-'));
  const core = await createMarginCore({ enabled: true, dbPath: path.join(directory, 'core.sqlite') });
  try {
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    const hostActor = core.bindHostActor(actor);
    const run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '授权验证', runtimeKind: 'pi' }, hostActor)).data;
    for (const forgedActor of [{ ...actor, actorType: 'agent' }, { ...actor, actorType: 'system' }, actor]) {
      await assert.rejects(
        core.runs.start({ requestId: `start-${forgedActor.actorType}-${forgedActor.subjectId}`, runId: run.id, expectedVersion: run.version }, forgedActor, { async activate() {}, async halt() {} }),
        (error) => error.code === 'permission_denied'
      );
    }
    assert.equal((await core.runs.get(run.id)).status, 'queued');
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
});
