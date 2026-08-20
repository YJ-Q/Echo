import { decidePermission } from '../permissions.js';
import { CoreContractError, digestInput, fail, ok, requireFields } from '../contracts.js';

const MEMORY_TYPES = new Set(['fact', 'preference', 'constraint', 'context', 'sensitive']);

function tokens(value) {
  return new Set(String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

function overlap(query, content) {
  const left = tokens(query);
  const right = tokens(content);
  if (left.size === 0) return 0;
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches / left.size;
}

export function createMemoryTools({ store }) {
  async function audit(input, context, permissionDecision, resultCode, entityId) {
    const auditId = store.idFactory('audit');
    await store.db.run(
      `INSERT INTO margin_audit_log
       (id, operation, request_id, actor_type, project_id, entity_type, entity_id, permission_decision, result_code, input_digest, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, 'memory', ?, ?, ?, ?, '{}', ?)`,
      auditId, input.operation, input.requestId, context.actorType, input.projectId, entityId || null,
      permissionDecision, resultCode, digestInput(input), store.clock()
    );
    return auditId;
  }

  async function memorySearch(input, context = {}) {
    input = { ...input, operation: 'memory_search' };
    const permission = decidePermission({ operation: input.operation, permissions: context.permissions });
    if (permission.decision !== 'allowed') {
      const auditId = await audit(input, context, permission.decision, permission.code);
      return fail(permission.code, { auditId });
    }
    try {
      requireFields(input, ['requestId', 'projectId', 'query', 'asOf']);
      const topK = Number(input.topK ?? 5);
      if (!Number.isInteger(topK) || topK < 1 || topK > 10) throw new CoreContractError('invalid_request', 'topK must be between 1 and 10');
      const params = [input.projectId, input.asOf, input.asOf];
      let taskClause = '';
      if (input.taskId) { taskClause = 'AND task_id = ?'; params.push(input.taskId); }
      let typeClause = '';
      if (input.memoryTypes?.length) {
        typeClause = `AND memory_type IN (${input.memoryTypes.map(() => '?').join(',')})`;
        params.push(...input.memoryTypes);
      }
      const rows = await store.db.all(
        `SELECT * FROM margin_memories WHERE project_id = ? AND confirmation_status = 'confirmed'
         AND deleted_at IS NULL AND superseded_by IS NULL AND valid_from <= ? AND (expires_at IS NULL OR expires_at > ?)
         ${taskClause} ${typeClause}`,
        ...params
      );
      const ranked = rows.map((row) => {
        const lexicalOverlap = overlap(input.query, row.content);
        const ageDays = Math.max(0, (new Date(input.asOf) - new Date(row.updated_at)) / 86400000);
        const recencyBucket = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.5 : 0;
        return { row, lexicalOverlap, score: lexicalOverlap * 0.6 + row.confidence * 0.3 + recencyBucket * 0.1 };
      }).filter((entry) => entry.lexicalOverlap > 0)
        .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at) || a.row.id.localeCompare(b.row.id))
        .slice(0, topK);
      const items = ranked.map(({ row, score }) => ({
        id: row.id, content: row.content, memoryType: row.memory_type, confidence: row.confidence,
        sourceSessionId: row.source_session_id, sourceEventId: row.source_event_id, version: row.version,
        validFrom: row.valid_from, expiresAt: row.expires_at, score: Number(score.toFixed(6))
      }));
      const auditId = await audit(input, context, 'allowed', items.length ? 'allowed' : 'no_relevant_memory');
      return ok(items.length ? { items } : { items: [], reason: 'no_relevant_memory' }, auditId);
    } catch (error) {
      const code = error instanceof CoreContractError ? error.code : 'storage_failure';
      try {
        const auditId = await audit(input, context, 'allowed', code);
        return fail(code, { retryable: code === 'storage_failure', auditId });
      } catch {
        return fail('storage_failure', { retryable: true });
      }
    }
  }

  async function memoryPropose(input, context = {}) {
    input = { ...input, operation: 'memory_propose' };
    const permission = decidePermission({ operation: input.operation, permissions: context.permissions });
    if (permission.decision !== 'allowed') {
      const auditId = await audit(input, context, permission.decision, permission.code);
      return fail(permission.code, { auditId });
    }
    if (input.durableIntent !== true) {
      const auditId = await audit(input, context, 'allowed', 'invalid_request');
      return fail('invalid_request', { auditId });
    }
    try {
      requireFields(input, ['requestId', 'projectId', 'content', 'memoryType', 'validFrom', 'sourceSessionId', 'sourceEventId']);
      const project = await store.db.get('SELECT id FROM margin_projects WHERE id=? AND deleted_at IS NULL', input.projectId);
      if (!project) return fail('project_not_found', { auditId: await audit(input, context, 'allowed', 'project_not_found') });
      if (input.taskId) {
        const task = await store.db.get('SELECT project_id FROM margin_tasks WHERE id=? AND deleted_at IS NULL', input.taskId);
        if (!task || task.project_id !== input.projectId) return fail('cross_project_reference', { auditId: await audit(input, context, 'allowed', 'cross_project_reference') });
      }
      if (!MEMORY_TYPES.has(input.memoryType) || typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
        throw new CoreContractError('invalid_request', 'Invalid memory proposal fields');
      }
      const confirmationRequired = input.memoryType === 'sensitive' || input.memoryType === 'preference';
      return await store.transaction(async (tx) => {
        const duplicate = await tx.get(`SELECT * FROM margin_memories WHERE project_id=? AND content=? AND memory_type=? AND confirmation_status='proposed' AND deleted_at IS NULL`, input.projectId, input.content, input.memoryType);
        if (duplicate) {
          const auditId = store.idFactory('audit');
          await tx.run(`INSERT INTO margin_audit_log VALUES (?, 'memory_propose', ?, ?, ?, 'memory', ?, 'allowed', 'duplicate', ?, '{}', ?)`,
            auditId, input.requestId, context.actorType, input.projectId, duplicate.id, digestInput(input), store.clock());
          return ok({ memory: duplicate, duplicate: true, confirmationRequired }, auditId);
        }
        const now = store.clock();
        const id = store.idFactory('memory');
        await tx.run(`INSERT INTO margin_memories
          (id,project_id,task_id,content,memory_type,confidence,confirmation_status,valid_from,expires_at,superseded_by,version,source_session_id,source_event_id,created_at,updated_at,deleted_at)
          VALUES (?,?,?,?,?,?,'proposed',?,?,NULL,1,?,?,?,?,NULL)`,
          id, input.projectId, input.taskId || null, input.content, input.memoryType, input.confidence,
          input.validFrom, input.expiresAt || null, input.sourceSessionId, input.sourceEventId, now, now);
        await tx.run(`INSERT INTO margin_events VALUES (?, 'memory', ?, ?, 'created', 1, '{}', ?, ?, ?)`, store.idFactory('event'), id, input.projectId, input.sourceSessionId, input.sourceEventId, now);
        if (confirmationRequired) await tx.run(`INSERT INTO margin_events VALUES (?, 'memory', ?, ?, 'confirmation_requested', 1, '{}', ?, ?, ?)`, store.idFactory('event'), id, input.projectId, input.sourceSessionId, input.sourceEventId, now);
        if (store.beforeEvidenceWrite) await store.beforeEvidenceWrite({ entityType: 'memory', entityId: id });
        const auditId = store.idFactory('audit');
        await tx.run(`INSERT INTO margin_audit_log VALUES (?, 'memory_propose', ?, ?, ?, 'memory', ?, 'allowed', 'allowed', ?, '{}', ?)`, auditId, input.requestId, context.actorType, input.projectId, id, digestInput(input), now);
        const memory = await tx.get('SELECT * FROM margin_memories WHERE id=?', id);
        return ok({ memory, duplicate: false, confirmationRequired }, auditId);
      });
    } catch (error) {
      const code = error instanceof CoreContractError ? error.code : 'storage_failure';
      try {
        const auditId = await audit(input, context, 'allowed', code);
        return fail(code, { retryable: code === 'storage_failure', auditId });
      } catch {
        return fail('storage_failure', { retryable: true });
      }
    }
  }

  return { memorySearch, memoryPropose };
}
