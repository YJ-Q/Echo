const SAFE_ERROR_CODES = new Set([
  'invalid_request', 'permission_denied', 'capability_required', 'not_found', 'version_conflict',
  'idempotency_conflict', 'invalid_transition', 'open_run_conflict', 'open_run_exists',
  'invalid_workstream_transition', 'runtime_unavailable', 'runtime_control_required', 'storage_failure',
  'transport_unavailable', 'workstream_not_found', 'run_not_found', 'cross_workstream_reference',
  'run_not_running'
]);

const PRIVATE_FIELD = (key) => {
  const value = String(key).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return value === 'actor' || value === 'capabilities' || value === 'database' || value.startsWith('database') ||
    value === 'authority' || value.startsWith('hostauthority') || value === 'runtime' ||
    value.startsWith('runtime') || value === 'surface' || value === 'correlationid' || value === 'stack' || value.startsWith('pi');
};

function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_FIELD(key))
    .map(([key, child]) => [key, safeValue(child)]));
}

function validId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 2_000;
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl ?? '').replace(/\/$/, '')}${path}`;
}

export function createApiClient({ fetchImpl = globalThis.fetch, baseUrl = '' } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('invalid_api_client_dependencies');
  let sequence = 0;
  const requestId = (prefix, supplied) => validId(supplied)
    ? supplied
    : `web_${prefix}_${Date.now().toString(36)}_${++sequence}`;

  async function request(path, { method = 'POST', body, id }) {
    try {
      const response = await fetchImpl(joinUrl(baseUrl, path), {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return stableEnvelope(await response.json(), id);
    } catch {
      return transportEnvelope(id);
    }
  }

  return Object.freeze({
    command(type, payload = {}, options = {}) {
      const id = requestId('command', options.requestId);
      const idempotencyKey = validId(options.idempotencyKey) ? options.idempotencyKey : requestId('command_intent');
      return request('/api/commands', {
        id,
        body: {
          type, requestId: id, idempotencyKey,
          ...(Number.isInteger(options.expectedVersion) ? { expectedVersion: options.expectedVersion } : {}),
          payload: safeValue(payload)
        }
      });
    },
    query(type, payload = {}, options = {}) {
      const id = requestId('query', options.requestId);
      return request('/api/queries', { id, body: { type, requestId: id, payload: safeValue(payload) } });
    },
    events(type, payload = {}, options = {}) {
      const id = requestId('events', options.requestId);
      const query = new URLSearchParams({ type, requestId: id, payload: JSON.stringify(safeValue(payload)) });
      return request(`/api/events?${query.toString()}`, { method: 'GET', id });
    },
    interact(payload = {}, options = {}) {
      const id = requestId('interaction', validId(options.requestId) ? options.requestId : payload.requestId);
      return request('/api/interactions', { id, body: interactionBody(payload, id) });
    }
  });
}

function interactionBody(payload, requestId) {
  const safePayload = safeValue(payload);
  const fields = ['workstreamId', 'runId', 'message'];
  return {
    requestId,
    ...Object.fromEntries(fields
      .filter((field) => Object.hasOwn(safePayload, field))
      .map((field) => [field, safePayload[field]]))
  };
}

function stableEnvelope(value, fallbackRequestId) {
  const meta = value?.meta && typeof value.meta === 'object' ? value.meta : {};
  const requestId = validId(meta.requestId) ? meta.requestId : fallbackRequestId;
  const contractVersion = typeof meta.contractVersion === 'string' && meta.contractVersion.trim() ? meta.contractVersion : '1.1';
  const correlationId = validId(meta.correlationId) ? meta.correlationId : 'invalid';
  if (value?.ok === true) return Object.freeze({
    ok: true, data: safeValue(value.data), meta: Object.freeze({ contractVersion, requestId, correlationId })
  });
  const code = SAFE_ERROR_CODES.has(value?.error?.code) ? value.error.code : 'storage_failure';
  const currentVersion = value?.error?.currentVersion ?? value?.error?.details?.currentVersion;
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable: value?.error?.retryable === true, ...(Number.isSafeInteger(currentVersion) && currentVersion >= 0 ? { currentVersion } : {}) }),
    meta: Object.freeze({ contractVersion, requestId, correlationId })
  });
}

function transportEnvelope(requestId) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'transport_unavailable', retryable: true }),
    meta: Object.freeze({ contractVersion: '1.1', requestId, correlationId: 'invalid' })
  });
}
