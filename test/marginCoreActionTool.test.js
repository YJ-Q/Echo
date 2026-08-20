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
  const confirmedInput = req(project.id, 'create', { title: 'send approved', riskLevel: 'external_write', confirmationRef: 'confirm-1' });
  const forged = await actionUpdate(confirmedInput, host);
  assert.equal(forged.data.status, 'pending_confirmation');
  const confirmed = await actionUpdate(confirmedInput, { ...host, confirmations: [{ ref: 'confirm-1', projectId: project.id, requestId: confirmedInput.requestId, riskLevel: 'external_write' }] });
  assert.equal(confirmed.data.status, 'pending');
  const replayInput = req(project.id, 'create', { title: 'replay', riskLevel: 'external_write', confirmationRef: 'confirm-1' });
  const replay = await actionUpdate(replayInput, { ...host, confirmations: [{ ref: 'confirm-1', projectId: project.id, requestId: replayInput.requestId, riskLevel: 'external_write' }] });
  assert.equal(replay.data.status, 'pending_confirmation');
  const wrongRiskInput = req(project.id, 'create', { title: 'wrong risk', riskLevel: 'high_risk', confirmationRef: 'confirm-2' });
  const wrongRisk = await actionUpdate(wrongRiskInput, { ...host, confirmations: [{ ref: 'confirm-2', projectId: project.id, requestId: wrongRiskInput.requestId, riskLevel: 'external_write' }] });
  assert.equal(wrongRisk.data.status, 'pending_confirmation');
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
  const failedAudit = await fixture.store.db.get("SELECT result_code FROM margin_audit_log WHERE operation='action_update' AND result_code='version_conflict'");
  assert.equal(failedAudit.result_code, 'version_conflict');
  const completed = await actionUpdate(req(project.id, 'complete', { actionId: created.data.id, expectedVersion: 1 }), host);
  assert.equal(completed.data.status, 'completed');
  assert.equal((await actionUpdate(req(project.id, 'complete', { actionId: created.data.id, expectedVersion: 2 }), host)).error.code, 'invalid_request');
  const other = await fixture.store.createProject({ scenario: 'career_project', goal: 'other', phase: 'p' }, seed);
  assert.equal((await actionUpdate(req(other.id, 'create', { taskId: task.id, title: 'bad', riskLevel: 'internal_write' }), host)).error.code, 'cross_project_reference');
});
