import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createPersistentWorkRepository } from '../src/core/persistentWorkRepository.js';
import { createWorkstreamSwitchService } from '../src/application/workstreamSwitchService.js';
import { createRunService } from '../src/application/runService.js';
import { createResumeBriefService } from '../src/application/resumeBriefService.js';

const CLOCK = () => '2026-09-01T00:00:00.000Z';
let seq = 0;

const runtimeControl = { async activate() {}, async halt() {} };

async function fixture(t) {
  let id = 0;
  const db = await createMarginCoreTestDb({ clock: CLOCK, idFactory: (p) => `${p}-${++id}` });
  await db.store.migrate();
  t.after(() => db.cleanup());
  const repository = createPersistentWorkRepository(db.store);
  const actor = { actorType: 'user', subjectId: `u-${++seq}`, sourceSessionId: `s-${seq}`, sourceEventId: `e-${seq}` };
  const hostActor = { ...actor };

  const wsA = (await repository.createWorkstream({ requestId: `wsa-${seq}`, scenario: 'career_project', goal: 'Job search', title: 'Job Search', priority: 0 }, hostActor)).data;
  const wsB = (await repository.createWorkstream({ requestId: `wsb-${seq}`, scenario: 'learning_research', goal: 'Learn stuff', title: 'Learning', priority: 0 }, hostActor)).data;
  const runs = createRunService({ repository, authorization: () => true });
  const resumeBriefs = createResumeBriefService({ repository, memories: null, clock: CLOCK });
  const switchService = createWorkstreamSwitchService({ repository, runs, resumeBriefs, authorization: () => true });

  const runA = (await runs.create({ requestId: `run-create-${seq}`, workstreamId: wsA.id, runtimeKind: 'pi', scope: 'Work on A' }, hostActor)).data;
  const startedA = (await runs.start({ requestId: `run-start-${seq}`, runId: runA.id, expectedVersion: 1 }, hostActor, runtimeControl)).data;

  return { repository, actor: hostActor, wsA, wsB, runA: startedA, runs, resumeBriefs, switchService };
}

test('switch pauses source run and returns target brief without activating target', async (t) => {
  const f = await fixture(t);
  const result = await f.switchService.switch({
    requestId: 'switch-1', sourceWorkstreamId: f.wsA.id, sourceRunId: f.runA.id,
    targetWorkstreamId: f.wsB.id, expectedVersion: f.runA.version
  }, f.actor, runtimeControl);

  assert.equal(result.sourceRun.status, 'paused');
  assert.ok(result.targetBrief);
  assert.equal(result.targetBrief.workstreamId, f.wsB.id);

  const targetRun = await f.repository.findOpenRun(f.wsB.id);
  assert.ok(!targetRun);
});

test('cross-workstream source run reference is rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => f.switchService.switch({
      requestId: 'bad-switch', sourceWorkstreamId: f.wsB.id, sourceRunId: f.runA.id,
      targetWorkstreamId: f.wsA.id, expectedVersion: f.runA.version
    }, f.actor, runtimeControl),
    (err) => { assert.equal(err.code, 'cross_workstream_reference'); return true; }
  );
});

test('target not found is rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => f.switchService.switch({
      requestId: 'no-target', sourceWorkstreamId: f.wsA.id, sourceRunId: f.runA.id,
      targetWorkstreamId: 'nonexistent', expectedVersion: f.runA.version
    }, f.actor, runtimeControl),
    (err) => { assert.equal(err.code, 'not_found'); return true; }
  );
});

test('same-key replay returns paused result and fresh target brief', async (t) => {
  const f = await fixture(t);
  const input = { requestId: 'replay-switch', sourceWorkstreamId: f.wsA.id, sourceRunId: f.runA.id, targetWorkstreamId: f.wsB.id, expectedVersion: f.runA.version };
  const first = await f.switchService.switch(input, f.actor, runtimeControl);
  const second = await f.switchService.switch(input, f.actor, runtimeControl);
  assert.equal(first.sourceRun.id, second.sourceRun.id);
  assert.equal(second.targetBrief.workstreamId, f.wsB.id);
});
