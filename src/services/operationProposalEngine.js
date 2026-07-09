import {
  createOperationProposal,
  getOperationEvents,
  getOperationProposals
} from '../storage/memoryStore.js';

const SUPPORTED_SCOPES = ['learning', 'memory', 'actions'];
const SUPPORTED_STATUSES = ['draft', 'awaiting_confirmation', 'confirmed', 'executed', 'dismissed', 'failed'];
const READ_ONLY_OPERATIONS = ['review', 'keep', 'keep_active'];
const REVERSIBLE_OPERATIONS = ['archive', 'dismiss', 'merge', 'pin', 'rename', 'reprioritize'];
const DESTRUCTIVE_OPERATIONS = ['delete', 'remove'];

export async function listOperationProposals({ scope, status, limit } = {}) {
  return getOperationProposals({
    scope: normalizeOptionalScope(scope),
    status: normalizeOptionalStatus(status),
    limit: normalizeLimit(limit, 20)
  });
}

export async function listOperationEvents({ proposalId, limit } = {}) {
  return getOperationEvents({
    proposalId: normalizeOptionalId(proposalId),
    limit: normalizeLimit(limit, 50)
  });
}

export async function draftOperationProposal(input = {}) {
  const scope = normalizeRequiredScope(input.scope);
  const operations = normalizeOperations(input);
  const riskLevel = highestRiskLevel([
    input.risk_level,
    ...operations.map((operation) => operation.risk_level)
  ]);
  const proposal = await createOperationProposal({
    scope,
    status: normalizeStatus(input.status || 'awaiting_confirmation'),
    summary: normalizeSummary(input.summary, { scope, operations, riskLevel }),
    riskLevel,
    operations: operations.map(({ risk_level: _riskLevel, ...operation }) => operation),
    preview: normalizePreview(input.preview),
    metadata: {
      operation_intent: normalizeOperationIntent(input.operation_intent || operations[0]?.operation_type),
      created_by: 'management_api',
      execution_state: 'not_executed',
      ...(isPlainObject(input.metadata) ? input.metadata : {})
    }
  });

  return proposal;
}

export function validateProposalFilters({ scope, status } = {}) {
  if (scope) {
    normalizeOptionalScope(scope);
  }

  if (status) {
    normalizeOptionalStatus(status);
  }
}

function normalizeOperations(input) {
  if (Array.isArray(input.operations) && input.operations.length > 0) {
    return input.operations.map((operation) => normalizeOperation(operation));
  }

  const operationType = normalizeOperationIntent(input.operation_intent || 'review');
  const targetType = normalizeTargetType(input.target_type || input.scope);
  const targetIds = Array.isArray(input.target_ids) ? input.target_ids : [];

  if (targetIds.length === 0 && input.target_id === undefined) {
    return [
      normalizeOperation({
        operation_type: operationType,
        target_type: targetType,
        target_id: null,
        reason: input.reason || '先创建可讨论的治理草案，不直接执行任何修改。'
      })
    ];
  }

  const ids = targetIds.length > 0 ? targetIds : [input.target_id];
  return ids.map((targetId) => normalizeOperation({
    operation_type: operationType,
    target_type: targetType,
    target_id: normalizeTargetId(targetId),
    reason: input.reason || '由治理请求生成，等待用户确认后再进入执行阶段。'
  }));
}

function normalizeOperation(operation = {}) {
  const operationType = normalizeOperationIntent(operation.operation_type || operation.type || 'review');
  const targetType = normalizeTargetType(operation.target_type);
  const normalized = {
    operation_type: operationType,
    target_type: targetType,
    target_id: normalizeTargetId(operation.target_id),
    reason: String(operation.reason || '等待用户确认后再决定是否执行。')
  };

  if (Array.isArray(operation.target_ids)) {
    normalized.target_ids = operation.target_ids.map(normalizeTargetId).filter((id) => id !== null);
  }

  if (operation.params && isPlainObject(operation.params)) {
    normalized.params = operation.params;
  }

  return {
    ...normalized,
    risk_level: riskForOperation(operationType)
  };
}

function normalizeRequiredScope(scope) {
  const normalized = normalizeOptionalScope(scope);

  if (!normalized) {
    const error = new Error('scope must be learning, memory, or actions');
    error.status = 400;
    error.code = 'invalid_management_scope';
    throw error;
  }

  return normalized;
}

function normalizeOptionalScope(scope) {
  if (!scope) {
    return undefined;
  }

  const normalized = String(scope).trim().toLowerCase();

  if (!SUPPORTED_SCOPES.includes(normalized)) {
    const error = new Error('scope must be learning, memory, or actions');
    error.status = 400;
    error.code = 'invalid_management_scope';
    throw error;
  }

  return normalized;
}

function normalizeStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();

  if (!SUPPORTED_STATUSES.includes(normalized)) {
    const error = new Error('status is not supported for operation proposals');
    error.status = 400;
    error.code = 'invalid_proposal_status';
    throw error;
  }

  return normalized;
}

function normalizeOptionalStatus(status) {
  return status ? normalizeStatus(status) : undefined;
}

function normalizeOperationIntent(value) {
  return String(value || 'review').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeTargetType(value) {
  const normalized = String(value || 'item').trim().toLowerCase();
  const aliases = {
    learning: 'learning_session',
    memories: 'memory',
    actions: 'action'
  };

  return aliases[normalized] || normalized;
}

function normalizeTargetId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('target id must be a positive integer');
    error.status = 400;
    error.code = 'invalid_target_id';
    throw error;
  }

  return id;
}

function normalizeOptionalId(value) {
  if (!value) {
    return undefined;
  }

  return normalizeTargetId(value);
}

function normalizeLimit(value, fallback) {
  const limit = Number(value || fallback);

  if (!Number.isInteger(limit) || limit <= 0) {
    return fallback;
  }

  return Math.min(limit, 100);
}

function normalizePreview(value) {
  return isPlainObject(value)
    ? {
      before: Array.isArray(value.before) ? value.before : [],
      after: Array.isArray(value.after) ? value.after : []
    }
    : { before: [], after: [] };
}

function normalizeSummary(value, { scope, operations, riskLevel }) {
  const summary = String(value || '').trim();

  if (summary) {
    return summary;
  }

  const operationLabel = operations.length === 1
    ? operations[0].operation_type
    : `${operations.length} 项操作`;
  const riskLabel = riskLevel === 'read_only' ? '只读' : riskLevel === 'destructive' ? '高风险' : '可回滚';

  return `建议为 ${scope} 创建 ${operationLabel} 治理草案，风险级别为${riskLabel}，等待确认后再执行。`;
}

function riskForOperation(operationType) {
  if (DESTRUCTIVE_OPERATIONS.includes(operationType)) {
    return 'destructive';
  }

  if (REVERSIBLE_OPERATIONS.includes(operationType)) {
    return 'reversible';
  }

  if (READ_ONLY_OPERATIONS.includes(operationType)) {
    return 'read_only';
  }

  return 'reversible';
}

function highestRiskLevel(levels) {
  const normalized = levels.filter(Boolean).map((level) => String(level).trim().toLowerCase());

  if (normalized.includes('destructive')) return 'destructive';
  if (normalized.includes('reversible')) return 'reversible';
  return 'read_only';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
