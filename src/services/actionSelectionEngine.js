const CURRENT_ACTION_STATUSES = new Set(['active', 'pending']);

const STATUS_WEIGHT = {
  active: 0,
  pending: 1,
  done: 2,
  dismissed: 3
};

export function sortActions(actions = []) {
  return [...actions].sort(compareActions);
}

export function selectCurrentAction(actions = []) {
  return sortActions(actions).find((action) => CURRENT_ACTION_STATUSES.has(action?.status)) || null;
}

export function compareActions(left = {}, right = {}) {
  const statusDelta = getStatusWeight(left.status) - getStatusWeight(right.status);

  if (statusDelta !== 0) {
    return statusDelta;
  }

  const priorityDelta = normalizePriority(left.priority) - normalizePriority(right.priority);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const recencyDelta = getActionTimestamp(right) - getActionTimestamp(left);

  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  const createdDelta = getCreatedTimestamp(right) - getCreatedTimestamp(left);

  if (createdDelta !== 0) {
    return createdDelta;
  }

  return normalizeId(right.id) - normalizeId(left.id);
}

function getStatusWeight(status) {
  return STATUS_WEIGHT[status] ?? Number.MAX_SAFE_INTEGER;
}

function normalizePriority(priority) {
  const value = Number(priority);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function getActionTimestamp(action = {}) {
  return parseTimestamp(action.updated_at) || parseTimestamp(action.created_at);
}

function getCreatedTimestamp(action = {}) {
  return parseTimestamp(action.created_at);
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeId(id) {
  const value = Number(id);
  return Number.isFinite(value) ? value : 0;
}
