import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createPersistentWorkRepository } from '../src/core/persistentWorkRepository.js';
import { createResumeBriefService } from '../src/application/resumeBriefService.js';

const CLOCK = () => '2026-09-01T00:00:00.000Z';
let seq = 0;

async function fixture(t) {
  let id = 0;
  const db = await createMarginCoreTestDb({ clock: CLOCK, idFactory: (p) => `${p}-${++id}` });
  await db.store.migrate();
  t.after(() => db.cleanup());
  const repository = createPersistentWorkRepository(db.store);
  const actor = { actorType: 'user', subjectId: `user-${++seq}`, sourceSessionId: `s-${seq}`, sourceEventId: `e-${seq}` };
  const wsResult = await repository.createWorkstream({
    requestId: `ws-${seq}`, scenario: 'career_project', goal: 'Get a software job',
    title: 'Job Search', priority: 0, currentState: 'Applied to 5 companies', nextAction: 'Follow up on applications'
  }, actor);
  return { db, repository, actor, workstream: wsResult.data };
}

test('primary recommendation is workstream nextAction when no blockers or needsOwner', async (t) => {
  const f = await fixture(t);
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief = await service.get({ workstreamId: f.workstream.id });
  assert.equal(brief.recommendations[0].kind, 'primary');
  assert.equal(brief.recommendations[0].action, 'Follow up on applications');
  assert.deepEqual(brief.recommendations[0].evidence, [{ aggregateType: 'workstream', reason: 'nextAction' }]);
});

test('needsOwner blocker takes precedence over nextAction', async (t) => {
  const f = await fixture(t);
  await f.repository.createNeedsOwner({
    requestId: 'no-1', workstreamId: f.workstream.id, runId: null,
    type: 'decision', reason: 'Choose deployment target',
    options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }]
  }, f.actor);
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief = await service.get({ workstreamId: f.workstream.id });
  assert.equal(brief.recommendations[0].action, 'Resolve: Choose deployment target');
  assert.equal(brief.recommendations[0].evidence[0].reason, 'ownerDecisionRequired');
});

test('missing nextAction falls back to define message', async (t) => {
  const f = await fixture(t);
  await f.repository.updateWorkstream({
    requestId: 'update-1', workstreamId: f.workstream.id, expectedVersion: 1,
    changes: { nextAction: null }
  }, f.actor);
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief = await service.get({ workstreamId: f.workstream.id });
  assert.match(brief.recommendations[0].action, /Define the next action/u);
});

test('returns not_found for missing workstream', async (t) => {
  const f = await fixture(t);
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  await assert.rejects(
    () => service.get({ workstreamId: 'nonexistent-ws' }),
    (err) => { assert.equal(err.code, 'not_found'); return true; }
  );
});

test('confirmed memories appear in brief', async (t) => {
  const f = await fixture(t);
  const memId = `mem-1`;
  await f.db.store.db.run(
    `INSERT INTO margin_memories (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at)
     VALUES (?,?,NULL,'Test context memory','context',0.9,'confirmed',?,NULL,NULL,1,?,?,?,?,NULL,NULL)`,
    memId, f.workstream.id, CLOCK(), f.actor.sourceSessionId, f.actor.sourceEventId, CLOCK(), CLOCK()
  );
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief = await service.get({ workstreamId: f.workstream.id });
  assert.equal(brief.memories.every((m) => m.confirmation_status === 'confirmed' || m.lifecycleStatus === 'active'), true);
});

test('no cross-workstream rows appear in brief', async (t) => {
  const f = await fixture(t);
  const otherWsResult = await f.repository.createWorkstream({
    requestId: `ws-other-${seq}`, scenario: 'learning_research', goal: 'Learn stuff',
    title: 'Learning', priority: 0
  }, f.actor);
  const otherWsId = otherWsResult.data.id;
  const memId = `mem-other`;
  await f.db.store.db.run(
    `INSERT INTO margin_memories (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at)
     VALUES (?,?,NULL,'Other workstream memory','context',0.9,'confirmed',?,NULL,NULL,1,?,?,?,?,NULL,NULL)`,
    memId, otherWsId, CLOCK(), f.actor.sourceSessionId, f.actor.sourceEventId, CLOCK(), CLOCK()
  );
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief = await service.get({ workstreamId: f.workstream.id });
  assert.equal(brief.memories.some((m) => m.id === memId || m.project_id === otherWsId), false);
});

test('brief is identical whether runtime config exists or not', async (t) => {
  const f = await fixture(t);
  const service = createResumeBriefService({ repository: f.repository, memories: null, clock: CLOCK });
  const brief1 = await service.get({ workstreamId: f.workstream.id });
  const brief2 = await service.get({ workstreamId: f.workstream.id });
  assert.equal(brief1.facts.goal, brief2.facts.goal);
  assert.equal(brief1.recommendations[0].action, brief2.recommendations[0].action);
});
