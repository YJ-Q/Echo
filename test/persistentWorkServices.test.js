import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMarginCore } from '../src/core/createMarginCore.js';

const actor = { actorType: 'user', sourceSessionId: 'host-session', sourceEventId: 'host-event' };

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-persistent-'));
  const core = await createMarginCore({ enabled: true, dbPath: path.join(directory, 'core.sqlite'), clock: () => '2026-08-23T12:00:00.000Z' });
  return { core, async cleanup() { await core.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('workstream creation is idempotent and writes one event', async () => {
  const f = await fixture();
  try {
    const input = { requestId: 'create-w1', title: 'Margin V1', goal: '建立 Persistent Core', scenario: 'learning_research' };
    const first = await f.core.workstreams.create(input, actor);
    const replay = await f.core.workstreams.create(input, actor);
    assert.equal(first.ok, true);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(replay.auditId, first.auditId);
    assert.equal((await f.core.store.db.get("SELECT COUNT(*) count FROM margin_events WHERE entity_id=? AND event_type='created'", first.data.id)).count, 1);
  } finally { await f.cleanup(); }
});

test('workstream creation rejects unbounded plan fields', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.core.workstreams.create({ requestId: 'invalid-plan', title: 'Margin', goal: '持续推进', scenario: 'career_project', currentPlan: 'free-form' }, actor),
      (error) => error.code === 'invalid_request'
    );
  } finally { await f.cleanup(); }
});

test('idempotency rejects a reused request ID with different input', async () => {
  const f = await fixture();
  try {
    await f.core.workstreams.create({ requestId: 'same', title: 'A', goal: '目标 A', scenario: 'career_project' }, actor);
    await assert.rejects(
      f.core.workstreams.create({ requestId: 'same', title: 'B', goal: '目标 B', scenario: 'career_project' }, actor),
      (error) => error.code === 'idempotency_conflict'
    );
    await assert.rejects(
      f.core.workstreams.create({ requestId: 'same', title: 'A', goal: '目标 A', scenario: 'career_project' }, { ...actor, actorType: 'agent' }),
      (error) => error.code === 'idempotency_conflict'
    );
  } finally { await f.cleanup(); }
});

test('V1 state tool updates legacy and Workstream status as one transaction', async () => {
  const f = await fixture();
  try {
    const workstream = (await f.core.workstreams.create({ requestId: 'w-state', title: 'Margin', goal: '持续推进', scenario: 'career_project' }, actor)).data;
    const result = await f.core.v1Tools.state_update({
      requestId: 'update-state', projectId: workstream.id, operation: 'update_project', expectedVersion: workstream.version,
      changes: { status: 'blocked' }, sourceSessionId: 'pi-session', sourceEventId: 'tool-call'
    }, { actorType: 'agent', permissions: { stateWrite: true } });
    assert.equal(result.ok, true);
    assert.equal((await f.core.workstreams.get(workstream.id)).status, 'blocked');
    assert.equal((await f.core.store.db.get('SELECT status FROM margin_projects WHERE id=?', workstream.id)).status, 'blocked');
    const snapshot = await f.core.continuity.snapshot({ projectId: workstream.id, query: '继续', asOf: '2026-08-23T12:00:00.000Z', recentDialogue: [] });
    assert.equal(snapshot.project.status, 'blocked');
  } finally { await f.cleanup(); }
});

test('run artifact and checkpoint remain scoped to one workstream', async () => {
  const f = await fixture();
  try {
    const workstream = (await f.core.workstreams.create({ requestId: 'w1', title: 'Margin', goal: '持续推进', scenario: 'career_project' }, actor)).data;
    const run = (await f.core.runs.create({ requestId: 'run1', workstreamId: workstream.id, scope: '完成 Phase 1', runtimeKind: 'pi' }, actor)).data;
    await assert.rejects(
      f.core.runs.create({ requestId: 'run2', workstreamId: workstream.id, scope: '重复 Run', runtimeKind: 'pi' }, actor),
      (error) => error.code === 'open_run_exists'
    );
    const artifact = (await f.core.artifacts.create({ requestId: 'a1', workstreamId: workstream.id, runId: run.id, type: 'document', title: '报告', uri: 'docs/report.md', contentHash: 'abc123' }, actor)).data;
    const checkpoint = (await f.core.checkpoints.create({ requestId: 'c1', workstreamId: workstream.id, runId: run.id, runVersion: run.version, stateVersion: workstream.version, stateDigest: 'digest-1', note: '开始前' }, actor)).data;
    assert.equal(artifact.workstream_id, workstream.id);
    assert.equal(checkpoint.run_id, run.id);
    assert.equal((await f.core.runs.get(run.id)).checkpoint_id, checkpoint.id);
  } finally { await f.cleanup(); }
});
