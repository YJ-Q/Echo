import {
  addOperationEvent,
  getOperationEvents,
  getOperationProposalById,
  setMemoryPriority,
  updateActionStatus,
  updateLearningSessionStatus,
  updateOperationProposalStatus
} from '../storage/memoryStore.js';

const EXECUTABLE_STATUSES = ['draft', 'awaiting_confirmation', 'confirmed'];
const DESTRUCTIVE_OPERATIONS = ['delete', 'remove'];
const NOOP_OPERATIONS = ['review', 'keep', 'keep_active'];
const SUPPORTED_OPERATION_KEYS = new Set([
  'review:item',
  'review:action',
  'review:memory',
  'review:learning_session',
  'keep:memory',
  'keep_active:action',
  'dismiss:action',
  'archive:memory',
  'pin:memory',
  'archive:learning_session'
]);

export async function confirmOperationProposal(id, { confirmationText = '' } = {}) {
  const proposalId = normalizeProposalId(id);
  const proposal = await getOperationProposalById(proposalId);

  if (!proposal) {
    const error = new Error('operation proposal not found');
    error.status = 404;
    error.code = 'operation_proposal_not_found';
    throw error;
  }

  if (proposal.status === 'executed') {
    return {
      proposal,
      events: await getOperationEvents({ proposalId }),
      already_executed: true
    };
  }

  if (!EXECUTABLE_STATUSES.includes(proposal.status)) {
    const error = new Error('operation proposal is not awaiting execution');
    error.status = 409;
    error.code = 'operation_proposal_not_executable';
    throw error;
  }

  await ensureExecutableProposal(proposal);

  const results = [];

  for (const operation of proposal.operations) {
    results.push(await executeOperation(operation));
  }

  const executed = await updateOperationProposalStatus(proposal.id, 'executed', {
    execution_state: 'executed',
    executed_at: new Date().toISOString(),
    confirmation_text: confirmationText || ''
  });

  await addOperationEvent({
    proposalId: proposal.id,
    eventType: 'proposal_executed',
    scope: proposal.scope,
    riskLevel: proposal.risk_level,
    operationSummary: proposal.summary,
    payload: {
      operation_count: proposal.operations.length,
      results
    }
  });

  return {
    proposal: executed,
    events: await getOperationEvents({ proposalId: proposal.id }),
    results,
    already_executed: false
  };
}

async function ensureExecutableProposal(proposal) {
  const hasDestructiveOperation = proposal.operations.some((operation) => {
    return DESTRUCTIVE_OPERATIONS.includes(String(operation.operation_type || '').toLowerCase());
  });

  if (proposal.risk_level === 'destructive' || hasDestructiveOperation) {
    await addOperationEvent({
      proposalId: proposal.id,
      eventType: 'proposal_execution_rejected',
      scope: proposal.scope,
      riskLevel: proposal.risk_level,
      operationSummary: proposal.summary,
      payload: {
        reason: 'destructive_operation_not_supported'
      }
    });

    const error = new Error('destructive proposals are not executable in the first confirmation flow');
    error.status = 400;
    error.code = 'destructive_proposal_not_supported';
    throw error;
  }

  for (const operation of proposal.operations) {
    const operationType = String(operation.operation_type || '').toLowerCase();
    const targetType = String(operation.target_type || '').toLowerCase();
    const key = `${operationType}:${targetType}`;

    if (!SUPPORTED_OPERATION_KEYS.has(key) && !NOOP_OPERATIONS.includes(operationType)) {
      const error = new Error(`operation ${operationType} on ${targetType} is not supported yet`);
      error.status = 400;
      error.code = 'unsupported_operation';
      throw error;
    }
  }
}

async function executeOperation(operation) {
  const operationType = String(operation.operation_type || '').toLowerCase();
  const targetType = String(operation.target_type || '').toLowerCase();

  if (NOOP_OPERATIONS.includes(operationType)) {
    return {
      operation_type: operationType,
      target_type: targetType,
      target_id: operation.target_id ?? null,
      status: 'noop'
    };
  }

  if (targetType === 'action' && operationType === 'dismiss') {
    return executeActionDismiss(operation);
  }

  if (targetType === 'memory' && operationType === 'archive') {
    return executeMemoryArchive(operation);
  }

  if (targetType === 'memory' && operationType === 'pin') {
    return executeMemoryPin(operation);
  }

  if (targetType === 'learning_session' && operationType === 'archive') {
    return executeLearningArchive(operation);
  }

  const error = new Error(`operation ${operationType} on ${targetType} is not supported yet`);
  error.status = 400;
  error.code = 'unsupported_operation';
  throw error;
}

async function executeActionDismiss(operation) {
  const targetId = normalizeTargetId(operation.target_id);
  const action = await updateActionStatus(targetId, 'dismissed');

  if (!action) {
    throwTargetNotFound('action');
  }

  return {
    operation_type: 'dismiss',
    target_type: 'action',
    target_id: targetId,
    status: 'executed',
    result_status: action.status
  };
}

async function executeMemoryArchive(operation) {
  const targetId = normalizeTargetId(operation.target_id);
  const memory = await setMemoryPriority(targetId, {
    salience: 0.1,
    priorityBucket: 'ambient',
    pinned: false,
    reinforcementCount: 1
  });

  if (!memory) {
    throwTargetNotFound('memory');
  }

  return {
    operation_type: 'archive',
    target_type: 'memory',
    target_id: targetId,
    status: 'executed',
    result_priority_bucket: memory.priority_bucket
  };
}

async function executeMemoryPin(operation) {
  const targetId = normalizeTargetId(operation.target_id);
  const memory = await setMemoryPriority(targetId, {
    salience: 0.96,
    priorityBucket: 'core',
    pinned: true
  });

  if (!memory) {
    throwTargetNotFound('memory');
  }

  return {
    operation_type: 'pin',
    target_type: 'memory',
    target_id: targetId,
    status: 'executed',
    result_priority_bucket: memory.priority_bucket
  };
}

async function executeLearningArchive(operation) {
  const targetId = normalizeTargetId(operation.target_id);
  const session = await updateLearningSessionStatus(targetId, 'archived');

  if (!session) {
    throwTargetNotFound('learning_session');
  }

  return {
    operation_type: 'archive',
    target_type: 'learning_session',
    target_id: targetId,
    status: 'executed',
    result_status: session.status
  };
}

function normalizeProposalId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('valid operation proposal id is required');
    error.status = 400;
    error.code = 'invalid_operation_proposal_id';
    throw error;
  }

  return id;
}

function normalizeTargetId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('operation target id must be a positive integer');
    error.status = 400;
    error.code = 'invalid_operation_target_id';
    throw error;
  }

  return id;
}

function throwTargetNotFound(targetType) {
  const error = new Error(`${targetType} target not found`);
  error.status = 404;
  error.code = 'operation_target_not_found';
  throw error;
}
