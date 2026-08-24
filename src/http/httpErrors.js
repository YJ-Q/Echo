import { CONTRACT_VERSION } from '../contracts/contractTypes.js';

const STABLE_CODES = new Set([
  'invalid_request', 'permission_denied', 'capability_required', 'not_found',
  'version_conflict', 'idempotency_conflict', 'invalid_transition', 'open_run_conflict',
  'runtime_unavailable', 'runtime_control_required', 'storage_failure', 'workstream_not_found',
  'run_not_found', 'open_run_exists', 'cross_workstream_reference',
  'invalid_workstream_transition', 'run_not_running'
]);

const PRIVATE_KEYS = new Set([
  'actor', 'capabilities', 'hostauthority', 'databasepath', 'database', 'runtime',
  'runtimereference', 'pi', 'prompt', 'reasoning', 'session', 'stack'
]);

export const HTTP_ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  permission_denied: 403,
  capability_required: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  invalid_transition: 409,
  open_run_conflict: 409,
  workstream_not_found: 404,
  run_not_found: 404,
  open_run_exists: 409,
  cross_workstream_reference: 400,
  invalid_workstream_transition: 409,
  run_not_running: 409,
  runtime_unavailable: 503,
  runtime_control_required: 503,
  storage_failure: 503
});

export function httpStatusFor(result) {
  return result?.ok === false ? (HTTP_ERROR_STATUS[result?.error?.code] ?? HTTP_ERROR_STATUS.storage_failure) : 200;
}

export function hasForbiddenBrowserField(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenBrowserField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => isPrivateKey(key) || hasForbiddenBrowserField(child));
}

export function failureEnvelope({ code = 'storage_failure', requestId, correlationId } = {}) {
  const stableCode = STABLE_CODES.has(code) ? code : 'storage_failure';
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: stableCode, retryable: stableCode === 'runtime_unavailable' || stableCode === 'storage_failure' }),
    meta: Object.freeze({ contractVersion: CONTRACT_VERSION, requestId: safeId(requestId), correlationId: safeId(correlationId) })
  });
}

export function sanitizeBrowserEnvelope(result, identity = {}) {
  if (!result || typeof result !== 'object') return failureEnvelope(identity);
  const meta = result.meta && typeof result.meta === 'object' ? result.meta : {};
  const requestId = safeId(meta.requestId ?? identity.requestId);
  const correlationId = safeId(meta.correlationId ?? identity.correlationId);
  const contractVersion = safeVersion(meta.contractVersion);
  if (result.ok === false) {
    const stable = STABLE_CODES.has(result.error?.code);
    const code = stable ? result.error.code : 'storage_failure';
    const details = safeErrorDetails(code, result.error?.details);
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code,
        retryable: stable ? result.error?.retryable === true : true,
        ...(details ? { details } : {})
      }),
      meta: Object.freeze({ contractVersion, requestId, correlationId })
    });
  }
  if (result.ok !== true) return failureEnvelope({ requestId, correlationId });
  return Object.freeze({
    ok: true,
    data: stripPrivateFields(result.data),
    meta: Object.freeze({ contractVersion, requestId, correlationId })
  });
}

function normalizeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function safeId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 2_000 ? value : 'invalid';
}

function safeVersion(value) {
  return typeof value === 'string' && value.trim() && value.length <= 100 ? value : CONTRACT_VERSION;
}

function safeErrorDetails(code, details) {
  const currentVersion = details?.currentVersion;
  return code === 'version_conflict' && Number.isSafeInteger(currentVersion) && currentVersion >= 0
    ? Object.freeze({ currentVersion })
    : null;
}

function stripPrivateFields(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isPrivateKey(key))
    .map(([key, child]) => [key, stripPrivateFields(child)]));
}

function isPrivateKey(key) {
  const normalized = normalizeKey(key);
  return PRIVATE_KEYS.has(normalized)
    || normalized.startsWith('reasoning')
    || normalized.startsWith('prompt')
    || normalized.startsWith('database')
    || normalized.startsWith('hostauthority')
    || normalized.startsWith('runtime')
    || normalized.startsWith('session')
    || normalized.startsWith('pi');
}
