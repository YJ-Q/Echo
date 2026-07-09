import {
  createAction,
  findActionBySuggestedIdentity,
  getActionById,
  getActions,
  updateActionStatus,
  addLearningEvent,
  updateLearningStep
} from '../storage/memoryStore.js';
import { getEchoState } from './echoStateEngine.js';
import { buildActionStepDoneEvent } from './learningEvents.js';

export async function createManualAction(input) {
  return createAction(normalizeActionInput({
    ...input,
    source: input.source || 'manual'
  }));
}

export async function createSuggestedAction(query = '') {
  const state = await getEchoState(query);
  const existingEchoAction = state.action_queue.find((action) => action.source === 'echo_state');

  if (state.next_action.type === 'resume_pending_action' && existingEchoAction) {
    return existingEchoAction;
  }

  const action = actionFromState(state);
  const reusableAction = await findReusableSuggestedAction(action.metadata.suggested_identity);

  if (reusableAction) {
    return reusableAction;
  }

  return createAction(action);
}

export async function findReusableSuggestedAction(identity) {
  return findActionBySuggestedIdentity(identity);
}

export async function listActions({ status, limit } = {}) {
  return getActions({ status, limit });
}

export async function setActionStatus(id, status) {
  const existingAction = await getActionById(id);

  if (!existingAction) {
    return null;
  }

  if (status === 'active') {
    const activeActions = await getActions({ status: 'active', limit: 50 });

    for (const action of activeActions) {
      if (action.id !== id) {
        await updateActionStatus(action.id, 'pending');
      }
    }
  }

  const updatedAction = await updateActionStatus(id, status);

  if (status === 'done' && existingAction.status !== 'done') {
    await syncLearningCompletionFromAction(existingAction);
  }

  return updatedAction;
}

function actionFromState(state) {
  const next = state.next_action;
  const suggestedIdentity = buildSuggestedActionIdentity(state);

  return normalizeActionInput({
    type: next.type,
    title: next.label,
    detail: next.detail,
    source: 'echo_state',
    priority: priorityForType(next.type),
    metadata: {
      suggested_identity: suggestedIdentity,
      reason: next.reason,
      decision_source: next.source,
      decision_confidence: next.confidence,
      decision_type: next.type,
      state_timestamp: state.timestamp,
      focus: state.current_state.focus,
      learning_session_id: state.current_learning?.id || null,
      learning_topic: state.current_learning?.topic || '',
      learning_step_index: Number.isFinite(state.current_learning?.current_step_index)
        ? state.current_learning.current_step_index
        : null,
      emotion: state.current_state.emotion,
      pattern: state.current_state.pattern
    }
  });
}

export function buildSuggestedActionIdentity(state) {
  const next = state.next_action || {};
  const currentLearning = state.current_learning || {};
  const currentAction = state.current_action || {};
  const currentState = state.current_state || {};
  const parts = [
    'echo_state',
    normalizeIdentityPart(next.type || 'unknown'),
    normalizeIdentityPart(next.source || ''),
    normalizeIdentityPart(currentLearning.id || ''),
    normalizeIdentityPart(currentLearning.topic || currentState.focus || ''),
    normalizeIdentityPart(Number.isFinite(currentLearning.current_step_index)
      ? currentLearning.current_step_index
      : ''),
    normalizeIdentityPart(next.type === 'resume_pending_action' ? currentAction.id || '' : '')
  ].filter((part) => part !== '');

  return parts.join(':');
}

function normalizeActionInput(input) {
  return {
    type: input.type || 'manual',
    title: input.title || input.label || '未命名行动',
    detail: input.detail || '',
    source: input.source || 'manual',
    priority: normalizePriority(input.priority),
    status: normalizeStatus(input.status),
    dueAt: input.dueAt || input.due_at || null,
    metadata: input.metadata || {}
  };
}

function normalizePriority(priority) {
  const value = Number.parseInt(priority, 10);

  if (!Number.isFinite(value)) {
    return 3;
  }

  return Math.min(Math.max(value, 1), 5);
}

function normalizeStatus(status) {
  return ['pending', 'active', 'done', 'dismissed'].includes(status) ? status : 'pending';
}

function priorityForType(type) {
  const priorities = {
    continue_learning: 1,
    resume_pending_action: 1,
    start_small: 2,
    ground_state: 2,
    reflect_recent: 3,
    open_conversation: 4
  };

  return priorities[type] || 3;
}

function normalizeIdentityPart(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._\-\u4e00-\u9fff]/g, '');
}

async function syncLearningCompletionFromAction(action) {
  const sessionId = normalizePositiveInteger(action.metadata?.learning_session_id);
  const stepIndex = normalizeNonNegativeInteger(action.metadata?.learning_step_index);

  if (sessionId === null || stepIndex === null) {
    return;
  }

  try {
    const session = await updateLearningStep(sessionId, stepIndex, 'done');

    if (!session) {
      return;
    }

    await addLearningEvent(buildActionStepDoneEvent({
      session,
      stepIndex,
      action
    }));
  } catch (error) {
    if (error?.code === 'learning_step_out_of_range') {
      return;
    }

    throw error;
  }
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
