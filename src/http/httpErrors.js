import { CONTRACT_VERSION } from '../contracts/contractTypes.js';

const STABLE_CODES = new Set([
  'invalid_request', 'permission_denied', 'not_found', 'version_conflict',
  'invalid_transition', 'runtime_unavailable', 'storage_failure'
]);

const PRIVATE_KEYS = new Set([
  'actor', 'capabilities', 'hostauthority', 'databasepath', 'database', 'runtime',
  'runtimereference', 'pi', 'prompt', 'reasoning', 'stack'
]);

export const HTTP_ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  permission_denied: 403,
  not_found: 404,
  version_conflict: 409,
  invalid_transition: 409,
  runtime_unavailable: 503,
  storage_failure: 500
});

export function httpStatusFor(result) {
  return result?.ok === false ? (HTTP_ERROR_STATUS[result?.error?.code] ?? HTTP_ERROR_STATUS.storage_failure) : 200;
}

export function hasForbiddenBrowserField(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenBrowserField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => PRIVATE_KEYS.has(normalizeKey(key)) || hasForbiddenBrowserField(child));
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
    const code = STABLE_CODES.has(result.error?.code) ? result.error.code : 'storage_failure';
    return Object.freeze({
      ok: false,
      error: Object.freeze({ code, retryable: code === 'runtime_unavailable' || code === 'storage_failure' }),
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

function stripPrivateFields(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(normalizeKey(key)))
    .map(([key, child]) => [key, stripPrivateFields(child)]));
}
