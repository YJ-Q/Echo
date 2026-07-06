import {
  createAction,
  getActions,
  updateActionStatus
} from '../storage/memoryStore.js';
import { getEchoState } from './echoStateEngine.js';

export async function createManualAction(input) {
  return createAction(normalizeActionInput({
    ...input,
    source: input.source || 'manual'
  }));
}

export async function createSuggestedAction(query = '') {
  const state = await getEchoState(query);
  const action = actionFromState(state);

  return createAction(action);
}

export async function listActions({ status, limit } = {}) {
  return getActions({ status, limit });
}

export async function setActionStatus(id, status) {
  return updateActionStatus(id, status);
}

function actionFromState(state) {
  const next = state.next_action;

  return normalizeActionInput({
    type: next.type,
    title: next.label,
    detail: next.detail,
    source: 'echo_state',
    priority: priorityForType(next.type),
    metadata: {
      reason: next.reason,
      state_timestamp: state.timestamp,
      focus: state.current_state.focus,
      emotion: state.current_state.emotion,
      pattern: state.current_state.pattern
    }
  });
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
    start_small: 2,
    reflect_recent: 3,
    open_conversation: 4
  };

  return priorities[type] || 3;
}
