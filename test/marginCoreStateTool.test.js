import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createStateTool } from '../src/core/tools/stateTool.js';

const seedContext = { requestId: 'seed', actorType: 'user', sourceSessionId: 's', sourceEventId: 'e', inputDigest: 'a'.repeat(64), permissionDecision: 'allowed' };
const host = { actorType: 'user', permissions: { stateWrite: true } };

async function setup(t) {
  let id = 0;
  const fixture = await createMarginCoreTestDb({ clock: () => '2026-08-20T00:00:00.000Z', idFactory: (p) => `${p}-${++id}` });
  t.after(() => fixture.cleanup());
  const project = await fixture.store.createProject({ scenario: 'career_project', goal: 'ship', phase: 'draft' }, seedContext);
  const task = await fixture.store.createTask({ projectId: project.id, title: 'resume', currentStep: 'draft', completionCondition: 'reviewed', status: 'active' }, seedContext);
  return { fixture, project, task, tool: createStateTool({ store: fixture.store }).stateUpdate };
}

function request(projectId, operation, payload = {}) {
  return { requestId: `r-${operation}`, projectId, operation, sourceSessionId: 's2', sourceEventId: 'e2', ...payload };
}

test('closed operations update blockers and completion with versions', async (t) => {
  const { project, task, tool } = await setup(t);
  const blocked = await tool(request(project.id, 'record_blocker', { taskId: task.id, expectedVersion: 1, blocker: 'waiting review' }), host);
  assert.equal(blocked.data.status, 'blocked');
  assert.match(blocked.auditId, /^audit-/u);
  assert.equal(blocked.data.version, 2);
  const completed = await tool(request(project.id, 'complete_task', { taskId: task.id, expectedVersion: 2 }), host);
  assert.equal(completed.data.status, 'completed');
  assert.equal(completed.data.version, 3);
});

test('permission, allowlist, stale version, and cross-project guards are stable', async (t) => {
  const { fixture, project, task, tool } = await setup(t);
  assert.equal((await tool(request(project.id, 'drop_table'), host)).error.code, 'invalid_request');
  assert.equal((await tool(request(project.id, 'update_project', { expectedVersion: 1, changes: { phase: 'x' } }), { actorType: 'agent', permissions: {} })).error.code, 'permission_denied');
  assert.equal((await tool(request(project.id, 'update_task', { taskId: task.id, expectedVersion: 9, changes: { title: 'x' } }), host)).error.code, 'version_conflict');
  assert.equal((await tool(request(project.id, 'update_project', { expectedVersion: 1, changes: { sql: 'DROP TABLE x' } }), host)).error.code, 'invalid_request');
  const other = await fixture.store.createProject({ scenario: 'career_project', goal: 'other', phase: 'p' }, seedContext);
  assert.equal((await tool(request(other.id, 'update_task', { taskId: task.id, expectedVersion: 1, changes: { title: 'x' } }), host)).error.code, 'cross_project_reference');
});

test('decision replacement and revocation preserve history', async (t) => {
  const { fixture, project, tool } = await setup(t);
  const first = await tool(request(project.id, 'replace_decision', { decisionKey: 'format', content: 'PDF' }), host);
  const mismatch = await tool(request(project.id, 'replace_decision', { decisionKey: 'channel', content: 'email', previousDecisionId: first.data.id, expectedVersion: 1 }), host);
  assert.equal(mismatch.error.code, 'invalid_request');
  const stale = await tool(request(project.id, 'replace_decision', { decisionKey: 'format', content: 'DOCX', previousDecisionId: first.data.id, expectedVersion: 9 }), host);
  assert.equal(stale.error.code, 'version_conflict');
  const second = await tool(request(project.id, 'replace_decision', { decisionKey: 'format', content: 'DOCX', previousDecisionId: first.data.id, expectedVersion: 1 }), host);
  assert.equal(second.data.status, 'confirmed');
  assert.equal((await fixture.store.db.get('SELECT status FROM margin_decisions WHERE id=?', first.data.id)).status, 'superseded');
  const revoked = await tool(request(project.id, 'revoke_decision', { decisionId: second.data.id, expectedVersion: 1 }), host);
  assert.equal(revoked.data.status, 'revoked');
});
