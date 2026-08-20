import { decidePermission } from '../permissions.js';
import { CoreContractError, digestInput, fail, ok } from '../contracts.js';

const OPERATIONS = new Set(['update_project', 'create_task', 'update_task', 'record_blocker', 'complete_task', 'replace_decision', 'revoke_decision']);
const PATCH_FIELDS = Object.freeze({
  update_project: new Set(['goal', 'phase', 'status']),
  update_task: new Set(['title', 'currentStep', 'blocker', 'completionCondition', 'status']),
  create_task: new Set(['title', 'currentStep', 'blocker', 'completionCondition', 'status'])
});

function assertClosedPatch(operation, patch) {
  const keys = Object.keys(patch || {});
  if (keys.length === 0 || keys.some((key) => !PATCH_FIELDS[operation].has(key))) {
    throw new CoreContractError('invalid_request', 'Unsupported or empty state fields');
  }
}

export function createStateTool({ store }) {
  function repositoryContext(input, context) {
    return {
      requestId: input.requestId, actorType: context.actorType, sourceSessionId: input.sourceSessionId,
      sourceEventId: input.sourceEventId, inputDigest: digestInput(input), permissionDecision: 'allowed'
      , auditId: store.idFactory('audit')
    };
  }

  async function directAudit(input, context, decision, code, entityType, entityId) {
    const id = store.idFactory('audit');
    await store.db.run(`INSERT INTO margin_audit_log VALUES (?, 'state_update', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      id, input.requestId || 'missing', context.actorType || 'agent', input.projectId || null, entityType || null,
      entityId || null, decision, code, digestInput(input), store.clock());
    return id;
  }

  async function decisionOperation(input, context) {
    return store.transaction(async (tx) => {
      const now = store.clock();
      let entity;
      let eventType;
      if (input.operation === 'replace_decision') {
        const project = await tx.get('SELECT id FROM margin_projects WHERE id=? AND deleted_at IS NULL', input.projectId);
        if (!project) throw new CoreContractError('project_not_found', 'Project not found');
        if (input.taskId) {
          const task = await tx.get('SELECT project_id FROM margin_tasks WHERE id=?', input.taskId);
          if (!task || task.project_id !== input.projectId) throw new CoreContractError('cross_project_reference', 'Cross-project task');
        }
        const current = input.previousDecisionId
          ? await tx.get('SELECT * FROM margin_decisions WHERE id=?', input.previousDecisionId)
          : await tx.get("SELECT * FROM margin_decisions WHERE project_id=? AND decision_key=? AND status='confirmed'", input.projectId, input.decisionKey);
        if (current && current.project_id !== input.projectId) throw new CoreContractError('cross_project_reference', 'Cross-project decision');
        if (current && (current.decision_key !== input.decisionKey || current.status !== 'confirmed')) {
          throw new CoreContractError('invalid_request', 'Decision replacement target does not match');
        }
        if (current && current.version !== input.expectedVersion) {
          const error = new CoreContractError('version_conflict', 'Decision version conflict');
          error.details = { expected: input.expectedVersion, actual: current.version };
          throw error;
        }
        const id = store.idFactory('decision');
        if (current) await tx.run("UPDATE margin_decisions SET status='superseded', version=version+1, updated_at=? WHERE id=?", now, current.id);
        await tx.run(`INSERT INTO margin_decisions VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, NULL, 1, ?, ?, ?, ?)`,
          id, input.projectId, input.taskId || null, input.decisionKey, input.content, input.effectiveAt || now,
          input.expiresAt || null, input.sourceSessionId, input.sourceEventId, now, now);
        if (current) await tx.run('UPDATE margin_decisions SET superseded_by=? WHERE id=?', id, current.id);
        entity = await tx.get('SELECT * FROM margin_decisions WHERE id=?', id);
        eventType = current ? 'superseded' : 'created';
      } else {
        const current = await tx.get('SELECT * FROM margin_decisions WHERE id=?', input.decisionId);
        if (!current) throw new CoreContractError('invalid_request', 'Decision not found');
        if (current.project_id !== input.projectId) throw new CoreContractError('cross_project_reference', 'Cross-project decision');
        if (current.version !== input.expectedVersion) throw new CoreContractError('version_conflict', 'Decision version conflict');
        await tx.run("UPDATE margin_decisions SET status='revoked', version=version+1, updated_at=? WHERE id=?", now, current.id);
        entity = await tx.get('SELECT * FROM margin_decisions WHERE id=?', current.id);
        eventType = 'revoked';
      }
      await tx.run(`INSERT INTO margin_events VALUES (?, 'decision', ?, ?, ?, ?, '{}', ?, ?, ?)`,
        store.idFactory('event'), entity.id, input.projectId, eventType, entity.version,
        input.sourceSessionId, input.sourceEventId, now);
      if (store.beforeEvidenceWrite) await store.beforeEvidenceWrite({ entityType: 'decision', entityId: entity.id });
      const auditId = store.idFactory('audit');
      await tx.run(`INSERT INTO margin_audit_log VALUES (?, 'state_update', ?, ?, ?, 'decision', ?, 'allowed', 'allowed', ?, '{}', ?)`,
        auditId, input.requestId, context.actorType, input.projectId, entity.id, digestInput(input), now);
      return ok(entity, auditId);
    });
  }

  async function stateUpdate(input, context = {}) {
    if (!OPERATIONS.has(input?.operation)) {
      const auditId = await directAudit(input || {}, context, 'denied', 'invalid_request');
      return fail('invalid_request', { auditId });
    }
    const permission = decidePermission({ operation: 'state_update', permissions: context.permissions });
    if (permission.decision !== 'allowed') {
      const auditId = await directAudit(input, context, permission.decision, permission.code);
      return fail(permission.code, { auditId });
    }
    try {
      const repoContext = repositoryContext(input, context);
      if (input.operation === 'update_project') {
        assertClosedPatch(input.operation, input.changes);
        return ok(await store.updateProject(input.projectId, input.changes, input.expectedVersion, repoContext), repoContext.auditId);
      }
      if (input.operation === 'create_task') {
        assertClosedPatch(input.operation, input.task);
        return ok(await store.createTask({ ...input.task, projectId: input.projectId }, repoContext), repoContext.auditId);
      }
      if (['update_task', 'record_blocker', 'complete_task'].includes(input.operation)) {
        const task = await store.getTask(input.taskId);
        if (!task) throw new CoreContractError('task_not_found', 'Task not found');
        if (task.project_id !== input.projectId) throw new CoreContractError('cross_project_reference', 'Cross-project task');
        const changes = input.operation === 'record_blocker' ? { blocker: input.blocker, status: 'blocked' }
          : input.operation === 'complete_task' ? { status: 'completed', blocker: null } : (input.changes || {});
        if (input.operation === 'update_task') assertClosedPatch(input.operation, changes);
        return ok(await store.updateTask(input.taskId, changes, input.expectedVersion, repoContext), repoContext.auditId);
      }
      return await decisionOperation(input, context);
    } catch (error) {
      const code = error instanceof CoreContractError ? error.code : 'storage_failure';
      try {
        const auditId = await directAudit(input, context, 'allowed', code);
        return fail(code, { retryable: code === 'storage_failure', details: error.details, auditId });
      } catch {
        return fail('storage_failure', { retryable: true });
      }
    }
  }

  return { stateUpdate };
}
