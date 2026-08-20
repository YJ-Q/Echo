import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createActionTool } from '../src/core/tools/actionTool.js';

const seed = { requestId: 'seed', actorType: 'user', sourceSessionId: 's', sourceEventId: 'e', inputDigest: 'a'.repeat(64), permissionDecision: 'allowed' };
const host = { actorType: 'user', permissions: { actionWrite: true } };

async function setup(t) {
  let id = 0;
  const fixture = await createMarginCoreTestDb({ clock: () => '2026-08-20T00:00:00.000Z', idFactory: (p) => `${p}-${++id}` });
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({ scenario: 'career_project', goal: 'ship', phase: 'p' }, seed);
  const task = await fixture.store.createTask({ projectId: project.id, title: 'task', currentStep: 'do', completionCondition: 'done' }, seed);
  return { fixture, project, task, actionUpdate: createActionTool({ store: fixture.store }).actionUpdate };
}

function req(projectId, operation, extra = {}) { return { requestId: `r-${operation}`, projectId, operation, sourceSessionId: 's2', sourceEventId: 'e2', ...extra }; }

test('creation distinguishes internal actions from confirmation-gated risks', async (t) => {
  const { project, actionUpdate } = await setup(t);
  const internal = await actionUpdate(req(project.id, 'create', { title: 'draft', riskLevel: 'internal_write' }), host);
  assert.equal(internal.data.status, 'pending');
  const risky = await actionUpdate(req(project.id, 'create', { title: 'send', riskLevel: 'external_write' }), host);
  assert.equal(risky.data.status, 'pending_confirmation');
  assert.equal(risky.data.confirmation_required, 1);
  const confirmed = await actionUpdate(req(project.id, 'create', { title: 'send approved', riskLevel: 'external_write', confirmationRef: 'confirm-1' }), host);
  assert.equal(confirmed.data.status, 'pending');
});

test('allowed transitions are versioned and cancellation is retained', async (t) => {
  const { fixture, project, actionUpdate } = await setup(t);
  const created = await actionUpdate(req(project.id, 'create', { title: 'work', riskLevel: 'internal_write' }), host);
  const active = await actionUpdate(req(project.id, 'activate', { actionId: created.data.id, expectedVersion: 1 }), host);
  assert.equal(active.data.status, 'active');
  const cancelled = await actionUpdate(req(project.id, 'cancel', { actionId: created.data.id, expectedVersion: 2 }), host);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal((await fixture.store.db.get('SELECT COUNT(*) count FROM margin_actions WHERE id=?', created.data.id)).count, 1);
});

test('permission, stale version, invalid transition, and cross-project task are rejected', async (t) => {
  const { fixture, project, task, actionUpdate } = await setup(t);
  assert.equal((await actionUpdate(req(project.id, 'create', { title: 'x', riskLevel: 'internal_write' }), { actorType: 'agent', permissions: {} })).error.code, 'permission_denied');
  const created = await actionUpdate(req(project.id, 'create', { title: 'x', riskLevel: 'internal_write' }), host);
  assert.equal((await actionUpdate(req(project.id, 'complete', { actionId: created.data.id, expectedVersion: 9 }), host)).error.code, 'version_conflict');
  const completed = await actionUpdate(req(project.id, 'complete', { actionId: created.data.id, expectedVersion: 1 }), host);
  assert.equal(completed.data.status, 'completed');
  assert.equal((await actionUpdate(req(project.id, 'complete', { actionId: created.data.id, expectedVersion: 2 }), host)).error.code, 'invalid_request');
  const other = await fixture.store.createProject({ scenario: 'career_project', goal: 'other', phase: 'p' }, seed);
  assert.equal((await actionUpdate(req(other.id, 'create', { taskId: task.id, title: 'bad', riskLevel: 'internal_write' }), host)).error.code, 'cross_project_reference');
});
