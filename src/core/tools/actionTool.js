import { digestInput, fail, ok } from '../contracts.js';

const OPERATIONS = new Set(['create', 'activate', 'complete', 'cancel']);
const RISKY = new Set(['external_write', 'high_risk']);
const RISKS = new Set(['read_only', 'internal_write', 'external_write', 'high_risk']);
const TRANSITIONS = Object.freeze({
  proposed: { cancel: 'cancelled' },
  pending_confirmation: { activate: 'pending', cancel: 'cancelled' },
  pending: { activate: 'active', complete: 'completed', cancel: 'cancelled' },
  active: { complete: 'completed', cancel: 'cancelled' }
});

export function createActionTool({ store }) {
  async function audit(input, context, decision, code, entityId) {
    const id = store.idFactory('audit');
    await store.db.run(`INSERT INTO margin_audit_log VALUES (?, 'action_update', ?, ?, ?, 'action', ?, ?, ?, ?, '{}', ?)`,
      id, input.requestId || 'missing', context.actorType || 'agent', input.projectId || null, entityId || null,
      decision, code, digestInput(input), store.clock());
    return id;
  }

  async function trustedConfirmation(input, context, tx, actionId) {
    if (!input.confirmationRef) return false;
    const match = context.confirmations?.find((entry) => entry.ref === input.confirmationRef &&
      entry.projectId === input.projectId && entry.riskLevel === input.riskLevel &&
      (actionId ? entry.actionId === actionId : entry.requestId === input.requestId));
    if (!match) return false;
    const used = await tx.get('SELECT id FROM margin_actions WHERE confirmation_ref=? AND id<>?', input.confirmationRef, actionId || '');
    return !used;
  }

  async function txFailure(tx, input, context, code, details) {
    const auditId = store.idFactory('audit');
    await tx.run(`INSERT INTO margin_audit_log VALUES (?, 'action_update', ?, ?, ?, 'action', ?, 'allowed', ?, ?, '{}', ?)`,
      auditId, input.requestId || 'missing', context.actorType || 'agent', input.projectId || null, input.actionId || null,
      code, digestInput(input), store.clock());
    return fail(code, { auditId, details });
  }

  async function actionUpdate(input = {}, context = {}) {
    if (!OPERATIONS.has(input.operation)) return fail('invalid_request', { auditId: await audit(input, context, 'denied', 'invalid_request') });
    if (context.permissions?.actionWrite !== true) return fail('permission_denied', { auditId: await audit(input, context, 'denied', 'permission_denied') });
    const required = ['requestId', 'projectId', 'sourceSessionId', 'sourceEventId'];
    const baseInvalid = required.some((field) => typeof input[field] !== 'string' || input[field].trim() === '');
    const createInvalid = input.operation === 'create' &&
      (typeof input.title !== 'string' || input.title.trim() === '' || !RISKS.has(input.riskLevel || 'internal_write'));
    const updateInvalid = input.operation !== 'create' &&
      (typeof input.actionId !== 'string' || input.actionId.trim() === '' || !Number.isInteger(input.expectedVersion));
    if (baseInvalid || createInvalid || updateInvalid) {
      return fail('invalid_request', { auditId: await audit(input, context, 'allowed', 'invalid_request') });
    }
    try {
      const project = await store.db.get('SELECT id FROM margin_projects WHERE id=? AND deleted_at IS NULL', input.projectId);
      if (!project) return fail('project_not_found', { auditId: await audit(input, context, 'allowed', 'project_not_found') });
      if (input.taskId) {
        const task = await store.db.get('SELECT project_id FROM margin_tasks WHERE id=? AND deleted_at IS NULL', input.taskId);
        if (!task || task.project_id !== input.projectId) return fail('cross_project_reference', { auditId: await audit(input, context, 'allowed', 'cross_project_reference') });
      }
      return await store.transaction(async (tx) => {
        const now = store.clock();
        let entity;
        let eventType;
        if (input.operation === 'create') {
          const riskLevel = input.riskLevel || 'internal_write';
          const confirmationRequired = RISKY.has(riskLevel);
          const confirmationValid = confirmationRequired ? await trustedConfirmation({ ...input, riskLevel }, context, tx) : false;
          const status = confirmationRequired && !confirmationValid ? 'pending_confirmation' : 'pending';
          const id = store.idFactory('action');
          await tx.run(`INSERT INTO margin_actions
            (id,project_id,task_id,title,detail,status,risk_level,due_at,confirmation_required,confirmation_ref,version,source_session_id,source_event_id,created_at,updated_at,deleted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL)`, id, input.projectId, input.taskId || null, input.title,
            input.detail || '', status, riskLevel, input.dueAt || null, Number(confirmationRequired), confirmationValid ? input.confirmationRef : null,
            input.sourceSessionId, input.sourceEventId, now, now);
          entity = await tx.get('SELECT * FROM margin_actions WHERE id=?', id);
          eventType = status === 'pending_confirmation' ? 'confirmation_requested' : 'created';
        } else {
          const current = await tx.get('SELECT * FROM margin_actions WHERE id=? AND deleted_at IS NULL', input.actionId);
          if (!current) return txFailure(tx, input, context, 'action_not_found');
          if (current.project_id !== input.projectId) return txFailure(tx, input, context, 'cross_project_reference');
          if (current.version !== input.expectedVersion) return txFailure(tx, input, context, 'version_conflict', { expected: input.expectedVersion, actual: current.version });
          if (current.status === 'pending_confirmation' && input.operation === 'activate') {
            const valid = await trustedConfirmation({ ...input, riskLevel: current.risk_level }, context, tx, current.id);
            if (!valid) return txFailure(tx, input, context, 'confirmation_required');
          }
          const nextStatus = TRANSITIONS[current.status]?.[input.operation];
          if (!nextStatus) return txFailure(tx, input, context, 'invalid_request');
          await tx.run(`UPDATE margin_actions SET status=?, confirmation_ref=COALESCE(?,confirmation_ref), version=version+1,
            source_session_id=?, source_event_id=?, updated_at=? WHERE id=?`, nextStatus, input.confirmationRef || null,
            input.sourceSessionId, input.sourceEventId, now, current.id);
          entity = await tx.get('SELECT * FROM margin_actions WHERE id=?', current.id);
          eventType = nextStatus === 'completed' ? 'completed' : 'updated';
        }
        await tx.run(`INSERT INTO margin_events VALUES (?, 'action', ?, ?, ?, ?, '{}', ?, ?, ?)`, store.idFactory('event'),
          entity.id, input.projectId, eventType, entity.version, input.sourceSessionId, input.sourceEventId, now);
        if (store.beforeEvidenceWrite) await store.beforeEvidenceWrite({ entityType: 'action', entityId: entity.id });
        const auditId = store.idFactory('audit');
        await tx.run(`INSERT INTO margin_audit_log VALUES (?, 'action_update', ?, ?, ?, 'action', ?, 'allowed', 'allowed', ?, '{}', ?)`,
          auditId, input.requestId, context.actorType, input.projectId, entity.id, digestInput(input), now);
        return ok(entity, auditId);
      });
    } catch {
      try {
        return fail('storage_failure', { retryable: true, auditId: await audit(input, context, 'allowed', 'storage_failure') });
      } catch {
        return fail('storage_failure', { retryable: true });
      }
    }
  }
  return { actionUpdate };
}
