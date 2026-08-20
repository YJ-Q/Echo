import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';

const context = {
  requestId: 'r1', actorType: 'user', sourceSessionId: 's1', sourceEventId: 'se1',
  inputDigest: 'a'.repeat(64), permissionDecision: 'allowed'
};

function deterministic() {
  let id = 0;
  return { clock: () => '2026-08-20T00:00:00.000Z', idFactory: (prefix = 'id') => `${prefix}-${++id}` };
}

test('project and task creation are deterministic, versioned, and evidenced', async (t) => {
  const fixture = await createMarginCoreTestDb(deterministic());
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({ scenario: 'learning_research', goal: 'g', phase: 'p' }, context);
  const task = await fixture.store.createTask({ projectId: project.id, title: 't', currentStep: 's', completionCondition: 'done' }, context);
  assert.equal(project.version, 1);
  assert.equal(task.version, 1);
  assert.equal(task.project_id, project.id);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, 2);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_audit_log')).count, 2);
});

test('updates increment once and stale versions leave no partial evidence', async (t) => {
  const fixture = await createMarginCoreTestDb(deterministic());
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({ scenario: 'career_project', goal: 'g', phase: 'p' }, context);
  const updated = await fixture.store.updateProject(project.id, { phase: 'next' }, 1, context);
  assert.equal(updated.version, 2);
  await assert.rejects(fixture.store.updateProject(project.id, { phase: 'bad' }, 1, context), (e) => e.code === 'version_conflict');
  assert.equal((await fixture.store.getProject(project.id)).phase, 'next');
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, 2);
});

test('cross-project task references are rejected', async (t) => {
  const fixture = await createMarginCoreTestDb(deterministic());
  t.after(() => fixture.cleanup());
  const p1 = await fixture.store.createProject({ scenario: 'career_project', goal: '1', phase: 'p' }, context);
  const p2 = await fixture.store.createProject({ scenario: 'career_project', goal: '2', phase: 'p' }, context);
  const task = await fixture.store.createTask({ projectId: p1.id, title: 't', currentStep: 's', completionCondition: 'd' }, context);
  await assert.rejects(fixture.store.updateTask(task.id, { projectId: p2.id, title: 'x' }, 1, context), (e) => e.code === 'cross_project_reference');
});

test('injected evidence failure rolls back the entity', async (t) => {
  const fixture = await createMarginCoreTestDb({ ...deterministic(), beforeEvidenceWrite: () => { throw new Error('injected'); } });
  t.after(() => fixture.cleanup());
  await assert.rejects(fixture.store.createProject({ scenario: 'learning_research', goal: 'g', phase: 'p' }, context), /injected/u);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_projects')).count, 0);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_events')).count, 0);
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_audit_log')).count, 0);
});
