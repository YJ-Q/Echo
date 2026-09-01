import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { CoreContractError } from '../src/core/contracts.js';
import { planContinuityContext, ContinuityPlanError } from '../src/continuity/contextPlanner.js';

const asOf = '2026-08-20T00:00:00.000Z';
const context = {
  requestId: 'seed', actorType: 'user', sourceSessionId: 'session-a', sourceEventId: 'event-a',
  inputDigest: 'a'.repeat(64), permissionDecision: 'allowed'
};

async function coreRows(db) {
  return Object.fromEntries(await Promise.all([
    'margin_projects', 'margin_tasks', 'margin_decisions', 'margin_memories', 'margin_events', 'margin_audit_log'
  ].map(async (table) => [table, await db.all(`SELECT * FROM ${table} ORDER BY id`)])));
}

async function setup(t) {
  let id = 0;
  const fixture = await createMarginCoreTestDb({
    clock: () => asOf,
    idFactory: (prefix) => `${prefix}-${++id}`
  });
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({
    scenario: 'learning_research', goal: 'finish the resume review', phase: 'review'
  }, context);
  const task = await fixture.store.createTask({
    projectId: project.id, title: 'Review resume', currentStep: 'continue the review', completionCondition: 'review complete', status: 'active'
  }, context);
  return { fixture, project, task };
}

test('snapshot and plan select bounded source-addressable continuity context deterministically', async (t) => {
  const { fixture, project, task } = await setup(t);
  await fixture.store.db.run(`INSERT INTO margin_decisions VALUES
    ('decision-2', ?, ?, 'format', 'Use concise format.', 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 'decision-session-2', 'decision-event-2', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-1', ?, ?, 'scope', 'Review only the latest draft.', 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 2, 'decision-session-1', 'decision-event-1', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z')`,
  project.id, task.id, project.id, task.id);
  await fixture.store.db.run(`INSERT INTO margin_memories
    (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at) VALUES
    ('memory-best', ?, ?, 'resume review uses the latest draft', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 3, 'memory-session', 'memory-event', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-lower', ?, NULL, 'resume review is scheduled', 'context', .6, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 'memory-session-2', 'memory-event-2', '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL, NULL)`,
  project.id, task.id, project.id);
  const before = await coreRows(fixture.store.db);

  const snapshot = await fixture.store.getContinuitySnapshot({
    projectId: project.id,
    query: 'continue resume review',
    asOf,
    memoryTopK: 1,
    recentDialogue: [{ id: 'turn-1', projectId: project.id, content: 'Continue the review.', sourceSessionId: 'session-a' }]
  });
  const plan = planContinuityContext(snapshot, { maxItems: 6 });

  assert.deepEqual(plan.selected.map((item) => item.sourceType), [
    'margin_project', 'margin_task', 'margin_decision', 'margin_decision', 'margin_memory', 'pi_recent_dialogue'
  ]);
  assert.deepEqual(plan.selected.map((item) => item.entityId), [
    project.id, task.id, 'decision-1', 'decision-2', 'memory-best', 'turn-1'
  ]);
  assert.deepEqual(plan.selected[0], {
    sourceType: 'margin_project', entityType: 'project', entityId: project.id, version: 1,
    sourceSessionId: 'session-a', reason: 'active_project', content: project.goal
  });
  assert.equal(plan.selected.at(-1).version, null);
  assert.match(plan.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await coreRows(fixture.store.db), before);
});

test('snapshot excludes cross-project, stale, unconfirmed, superseded, deleted, future, and inactive entities', async (t) => {
  const { fixture, project, task } = await setup(t);
  const other = await fixture.store.createProject({ scenario: 'career_project', goal: 'other', phase: 'other' }, context);
  await fixture.store.createTask({ projectId: other.id, title: 'Other task', currentStep: 'do not recall', completionCondition: 'never', status: 'active' }, context);
  await fixture.store.db.run(`INSERT INTO margin_decisions VALUES
    ('decision-current', ?, ?, 'current', 'Current decision', 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-expired', ?, ?, 'expired', 'Expired decision', 'confirmed', '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-revoked', ?, ?, 'revoked', 'Revoked decision', 'revoked', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-superseded', ?, ?, 'superseded', 'Superseded decision', 'superseded', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-replaced', ?, ?, 'replaced', 'Replaced decision', 'confirmed', '2026-08-01T00:00:00.000Z', NULL, 'decision-current', 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z'),
    ('decision-other', ?, NULL, 'other', 'Other decision', 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z')`,
  project.id, task.id, project.id, task.id, project.id, task.id, project.id, task.id, project.id, task.id, other.id);
  await fixture.store.db.run(`INSERT INTO margin_memories
    (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at,archived_at) VALUES
    ('memory-current', ?, ?, 'current resume review', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-proposed', ?, NULL, 'proposed resume review', 'context', .9, 'proposed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-expired', ?, NULL, 'expired resume review', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-future', ?, NULL, 'future resume review', 'context', .9, 'confirmed', '2026-08-21T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-superseded', ?, NULL, 'superseded resume review', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, 'memory-current', 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL),
    ('memory-deleted', ?, NULL, 'deleted resume review', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL),
    ('memory-other', ?, NULL, 'other resume review', 'context', .9, 'confirmed', '2026-08-01T00:00:00.000Z', NULL, NULL, 1, 's', 'e', '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', NULL, NULL)`,
  project.id, task.id, project.id, project.id, project.id, project.id, project.id, other.id);

  const snapshot = await fixture.store.getContinuitySnapshot({ projectId: project.id, query: 'resume review', asOf, memoryTopK: 11, recentDialogue: [] });

  assert.equal(snapshot.project.id, project.id);
  assert.equal(snapshot.activeTask.id, task.id);
  assert.deepEqual(snapshot.decisions.map(({ id }) => id), ['decision-current']);
  assert.deepEqual(snapshot.memories.map(({ id }) => id), ['memory-current']);
  await fixture.store.db.run("UPDATE margin_tasks SET status = 'completed' WHERE id = ?", task.id);
  const noActiveTask = await fixture.store.getContinuitySnapshot({ projectId: project.id, query: 'resume review', asOf, memoryTopK: 5, recentDialogue: [] });
  assert.equal(noActiveTask.activeTask, undefined);
});

test('snapshot rejects inactive and deleted projects', async (t) => {
  const { fixture, project } = await setup(t);
  await fixture.store.db.run("UPDATE margin_projects SET status = 'archived' WHERE id = ?", project.id);
  await assert.rejects(
    fixture.store.getContinuitySnapshot({ projectId: project.id, query: 'resume', asOf, memoryTopK: 1, recentDialogue: [] }),
    (error) => error instanceof CoreContractError && error.code === 'project_not_found'
  );
  await fixture.store.db.run("UPDATE margin_projects SET status = 'active', deleted_at = ? WHERE id = ?", asOf, project.id);
  await assert.rejects(
    fixture.store.getContinuitySnapshot({ projectId: project.id, query: 'resume', asOf, memoryTopK: 1, recentDialogue: [] }),
    (error) => error instanceof CoreContractError && error.code === 'project_not_found'
  );
});

test('snapshot rejects a missing project and planner reports bounded exclusions and invalid budgets', async (t) => {
  const { fixture, project } = await setup(t);
  await assert.rejects(
    fixture.store.getContinuitySnapshot({ projectId: 'missing', query: 'resume', asOf, memoryTopK: 1, recentDialogue: [] }),
    (error) => error instanceof CoreContractError && error.code === 'project_not_found'
  );
  const snapshot = await fixture.store.getContinuitySnapshot({
    projectId: project.id, query: 'resume', asOf, memoryTopK: 1,
    recentDialogue: [{ id: 'turn-2', projectId: project.id, content: 'Resume.', sourceSessionId: 's' }]
  });
  const plan = planContinuityContext(snapshot, { maxItems: 1 });
  assert.equal(plan.selected.length, 1);
  assert.deepEqual(plan.excluded, [
    { entityId: snapshot.activeTask.id, sourceType: 'margin_task', reason: 'item_budget_exceeded' },
    { entityId: 'turn-2', sourceType: 'pi_recent_dialogue', reason: 'item_budget_exceeded' }
  ]);
  assert.throws(() => planContinuityContext(snapshot, { maxItems: 0 }), (error) => error instanceof ContinuityPlanError && error.code === 'invalid_context_budget');
});

test('snapshot rejects recent dialogue without the requested project scope before planning', async (t) => {
  const { fixture, project } = await setup(t);
  const other = await fixture.store.createProject({ scenario: 'career_project', goal: 'other', phase: 'other' }, context);

  for (const dialogue of [
    { id: 'unscoped', content: 'Do not mix this turn.' },
    { id: 'other-project', projectId: other.id, content: 'Do not mix this turn.' }
  ]) {
    await assert.rejects(
      fixture.store.getContinuitySnapshot({ projectId: project.id, query: 'resume', asOf, memoryTopK: 1, recentDialogue: [dialogue] }),
      (error) => error instanceof CoreContractError && ['invalid_request', 'cross_project_reference'].includes(error.code)
    );
  }
});
