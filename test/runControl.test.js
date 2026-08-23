import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

const actor = { actorType: 'user', sourceSessionId: 'host', sourceEventId: 'event' };

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
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    let run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '验证控制', runtimeKind: 'pi' }, actor)).data;
    run = (await core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: run.version }, actor, runtimeControl)).data;
    assert.equal(run.status, 'running');
    const replayedStart = (await core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: 1 }, actor, runtimeControl)).data;
    assert.equal(replayedStart.id, run.id);
    assert.deepEqual(calls, [`activate:${run.id}`]);
    run = (await core.runs.pause({ requestId: 'pause', runId: run.id, expectedVersion: run.version }, actor, runtimeControl)).data;
    assert.equal(run.status, 'paused');
    assert.ok(run.checkpoint_id);
    assert.equal((await core.checkpoints.latest(run.id)).id, run.checkpoint_id);
    await core.close();
    core = await createMarginCore({ enabled: true, dbPath, clock: () => '2026-08-23T12:01:00.000Z' });
    assert.equal((await core.runs.get(run.id)).status, 'paused');
    run = (await core.runs.resume({ requestId: 'resume', runId: run.id, expectedVersion: run.version }, actor, runtimeControl)).data;
    run = (await core.runs.stop({ requestId: 'stop', runId: run.id, expectedVersion: run.version }, actor, runtimeControl)).data;
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
    const run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '验证失败', runtimeKind: 'pi' }, actor)).data;
    await assert.rejects(core.runs.start({ requestId: 'start', runId: run.id, expectedVersion: 1 }, actor, { async activate() { throw new Error('offline'); }, async halt() {} }), /offline/);
    assert.equal((await core.runs.get(run.id)).status, 'queued');
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
});

test('agent and system actors cannot control Runs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-control-auth-'));
  const core = await createMarginCore({ enabled: true, dbPath: path.join(directory, 'core.sqlite') });
  try {
    const workstream = (await core.workstreams.create({ requestId: 'w', title: 'Margin', goal: 'Phase 1', scenario: 'learning_research' }, actor)).data;
    const run = (await core.runs.create({ requestId: 'r', workstreamId: workstream.id, scope: '授权验证', runtimeKind: 'pi' }, actor)).data;
    for (const actorType of ['agent', 'system']) {
      await assert.rejects(
        core.runs.start({ requestId: `start-${actorType}`, runId: run.id, expectedVersion: run.version }, { ...actor, actorType }, { async activate() {}, async halt() {} }),
        (error) => error.code === 'permission_denied'
      );
    }
    assert.equal((await core.runs.get(run.id)).status, 'queued');
  } finally { await core.close(); await rm(directory, { recursive: true, force: true }); }
});
