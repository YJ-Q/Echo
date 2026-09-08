// S4 Cost Telemetry — pure v1 usage-record builder over one provider `token_usage_record`.
//
// One persisted line maps verbatim to one native per-request `token_usage_record` (unique by
// `response_id`). Fields are copied verbatim from provider-reported numbers; nothing is estimated,
// derived, or re-summed into a fact. Cumulative sidecars (`turnUsage`/`threadUsage`) are retained
// for audit/reconciliation only and are never used to compute cost. `model`/`provider` are resolved
// once per rollout from that file's `session_meta` (provenance recorded) because neither appears on
// the usage record itself.

const SCHEMA_VERSION = 1;
export const KIND_USAGE = 'usage';

// Native provider field -> persisted camelCase field. Order here is the canonical report order.
export const USAGE_FIELD_MAP = Object.freeze({
  input_tokens: 'input',
  cached_input_tokens: 'cachedInput',
  cache_write_input_tokens: 'cacheWriteInput',
  output_tokens: 'output',
  reasoning_output_tokens: 'reasoningOutput',
  total_tokens: 'total',
});

export const MODEL_PROVENANCE_LABEL = 'codex_session_meta.base_instructions';

function posInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Best-effort model name parsed out of Codex session_meta.base_instructions (the only place the
// native telemetry records name the model). Mirrors the S3 reader's probe.
function parseModel(text) {
  const m = String(text ?? '').match(/(?:GPT-|gpt-)\d+(?:\.\d+)?(?:-[a-zA-Z0-9-]+)?|o\d+(?:-[a-zA-Z0-9-]+)?|grok-[\w.-]+|claude-[\w.-]+|deepseek[\w-]*/i);
  return m ? m[0] : null;
}

// Map one native usage object (snake_case) to the canonical camelCase bucket set. Present numeric
// members are kept verbatim; absent/malformed members become null (never synthesized).
export function mapUsageObject(nativeUsage) {
  if (!nativeUsage || typeof nativeUsage !== 'object') return null;
  const out = {};
  for (const [native, camel] of Object.entries(USAGE_FIELD_MAP)) {
    out[camel] = nativeUsage[native] === undefined || nativeUsage[native] === null ? null : posInt(nativeUsage[native]);
  }
  return out;
}

// Resolve { provider, model, hasMeta } from a parsed native `session_meta` payload. `model_provider`
// is verbatim when present; the model name is parsed from `base_instructions` text. Absent metadata
// fails open to { provider: null, model: null, hasMeta: false }.
export function resolveMeta(payload) {
  if (!payload || typeof payload !== 'object') return { provider: null, model: null, hasMeta: false };
  const provider = typeof payload.model_provider === 'string' && payload.model_provider.trim()
    ? payload.model_provider.trim() : null;
  let instructions = payload.base_instructions;
  if (instructions && typeof instructions !== 'string') instructions = instructions?.text;
  const model = typeof instructions === 'string' && instructions.trim() ? parseModel(instructions) : null;
  return { provider, model, hasMeta: true };
}

// Build the canonical persisted v1 usage record from one parsed native `token_usage_record` line plus
// that rollout's resolved meta. Returns null when there is no usable usage payload or response_id
// (so callers skip such lines rather than crash on a half-written/odd native record).
export function buildUsageRecord({ native, meta = {}, sourceId, home, rel, role, capturedAt }) {
  if (!native || typeof native !== 'object') return null;
  const p = native.payload || {};
  const responseId = typeof p.response_id === 'string' && p.response_id.trim() ? p.response_id : null;
  const usage = mapUsageObject(p.usage);
  if (!responseId || !usage) return null;
  const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    v: SCHEMA_VERSION,
    kind: KIND_USAGE,
    agent: 'codex',
    sourceId,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
    modelProvenance: meta.hasMeta ? (meta.model ? MODEL_PROVENANCE_LABEL : 'codex_session_meta.unresolved') : 'none',
    sessionId: s(p.session_id),
    threadId: s(p.thread_id),
    turnId: s(p.turn_id),
    rootTurnId: s(p.root_turn_id),
    responseId,
    ts: typeof native.timestamp === 'string' ? native.timestamp : null,
    capturedAt: capturedAt ?? new Date().toISOString(),
    usage,
    turnUsage: mapUsageObject(p.turn_token_usage),
    threadUsage: mapUsageObject(p.thread_token_usage),
    provenance: { home, rel, role: role === 'archived' ? 'archived' : 'active' },
  };
}

// Compact identity digest used for idempotency. Two records with the same key but a different digest
// are a provider-level anomaly (never merged), surfaced in ingest status.
export function usageDigest(record) {
  return JSON.stringify({
    sid: record.sessionId, rid: record.responseId,
    provider: record.provider, model: record.model, u: record.usage,
  });
}

export function dedupKey(sourceId, responseId) {
  return `${String(sourceId)}:${String(responseId)}`;
}

export function encodeUsageRecord(record) {
  return JSON.stringify(record);
}
