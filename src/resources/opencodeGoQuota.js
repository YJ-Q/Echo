import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// OpenCode Go subscription quota reader.
//
// Source: `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <opencode-go.key>`.
// Verified live schema (2026-09-08):
//   { "usage": {
//       "rolling": { "status":"ok", "percent":<used%>, "resetsAt":"<ISO>" },  // ~5h window
//       "weekly":  { "status":"ok", "percent":<used%>, "resetsAt":"<ISO>" },  // ~7d window
//       "monthly": { "status":"ok", "percent":<used%>, "resetsAt":"<ISO>" } } }// ~monthly window
// Auth semantics: 200 -> usage JSON; 401 (missing/unauthorized key) -> { type:"error", error:{...} }.
// `percent` is USED percent; remaining = clamp(100 - percent, 0, 100).
//
// Credential handling: the opencode-go API key is read from the Pi agent's own auth store
// ({home}/agent/auth.json under the "opencode-go" provider) and is held ONLY in memory while the
// request is built. It is never copied into the Margin Source Registry, never logged, never
// telemetry, never part of a resource DTO, never in HANDOFF, and never surfaced elsewhere.

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const REFRESH_MS = 60_000; // reasonable refresh interval; unchanged sources stay served from cache
const TIMEOUT_MS = 10_000;
const SOURCE_VERSION = 'opencode_go_zen_v1_usage_v1';

// Quota windows map to UI labels: 5h / 7d / M. Durations are representative constants the UI uses
// to label the window; the authoritative boundary is the endpoint's resetsAt timestamp.
const WINDOWS = {
  rolling: { label: '5h', minutes: 300 },
  weekly: { label: '7d', minutes: 10080 },
  monthly: { label: 'M', minutes: 43200 },
};

// In-memory LKG + freshness only. No watcher, no DB, no telemetry. Keyed by home; the credential
// signature changes invalidate the entry so a provider key/config switch forces a re-read.
const cache = new Map();
export function resetOpenCodeGoQuotaCache() { cache.clear(); }

export function resolveOpenCodeGoCredential(home) {
  if (typeof home !== 'string' || !home.trim()) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(home, 'agent', 'auth.json'), 'utf8').replace(/^\uFEFF/, ''));
    const key = typeof auth === 'object' && auth ? auth['opencode-go']?.key : undefined;
    return typeof key === 'string' && key.trim() ? key.trim() : null;
  } catch { return null; }
}

let injectedFetch = null;
export function setGoQuotaFetchImpl(fn) { injectedFetch = fn; }

async function defaultFetch(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status !== 200) return { ok: false, reason: `http_${res.status}` };
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

function anyWindowPastReset(body, now) {
  return Object.keys(WINDOWS).some((nativeKey) => {
    const ms = Date.parse(String(body?.usage?.[nativeKey]?.resetsAt ?? ''));
    return Number.isFinite(ms) && body?.usage?.[nativeKey] != null && ms <= now;
  });
}

// Normalize one live usage response into quota resource records. Each window is a separate
// record exposing REMAINING (100 - used), clamped to [0,100]. A window that has already rolled
// (now >= resetsAt) while this snapshot predates the reset has no trusted value for the CURRENT
// window: remaining is null and stale is true — never a guessed fresh 100%.
function toResources(body, fetchMs, now, { agent = 'pi', provider = 'opencode-go' } = {}) {
  const usage = body?.usage;
  if (!usage || typeof usage !== 'object') return [];
  const records = [];
  for (const [nativeKey, { label, minutes }] of Object.entries(WINDOWS)) {
    const w = usage[nativeKey];
    if (!w || typeof w !== 'object') continue;
    const percentUsed = Number(w.percent);
    if (!Number.isFinite(percentUsed) || percentUsed < 0) continue;
    const resetsMs = Date.parse(String(w.resetsAt ?? ''));
    if (!Number.isFinite(resetsMs)) continue;
    const expiredStale = now >= resetsMs && fetchMs < resetsMs;
    const remaining = expiredStale ? null : Math.max(0, Math.round(100 - percentUsed));
    records.push({
      agent, provider, accessMode: 'subscription', resourceType: 'quota',
      window: label, windowDurationMinutes: minutes, plan: 'opencode-go',
      percentUsed: Math.min(100, percentUsed), remaining, resetsAt: Math.floor(resetsMs / 1000),
      status: String(w.status ?? ''), timestamp: new Date(fetchMs).toISOString(),
      stale: expiredStale, provenance: 'opencode_go_zen_v1_usage', sourceVersion: SOURCE_VERSION,
      sourceStability: 'live-subscription-endpoint',
    });
  }
  return records;
}

// Returns { resources, available, reason, freshAt, stale, failed }.
// - no credential / no home -> available:false (Go quota unavailable; API Today unaffected).
// - success -> fresh snapshot.
// - transient failure with LKG -> keep last trusted snapshot marked stale.
// - transient failure with no LKG -> unavailable.
export async function readGoQuotaResources({ home, credential = null, cacheKey = null, agent = 'pi', provider = 'opencode-go', now = Date.now(), fetchFn = null } = {}) {
  const hasHome = typeof home === 'string' && home.trim();
  const suppliedCredential = typeof credential === 'string' && credential.trim() ? credential.trim() : null;
  if (!hasHome && !suppliedCredential) return { resources: [], available: false, reason: 'no_home', freshAt: null, stale: false, failed: false };
  const token = suppliedCredential || resolveOpenCodeGoCredential(home);
  if (!token) return { resources: [], available: false, reason: 'no_credential', freshAt: null, stale: false, failed: false };

  const credentialSig = createHash('sha256').update(token).digest('hex');
  const key = String(cacheKey || home || `credential:${credentialSig}`);
  const previous = cache.get(key);
  const sameCredential = previous?.credentialSig === credentialSig;
  const expired = previous?.body ? anyWindowPastReset(previous.body, now) : false;
  const needsRefresh = !previous || previous.credentialSig !== credentialSig || previous.readFailed
    || (now - (previous.at ?? 0)) >= REFRESH_MS || expired;

  if (!needsRefresh) {
    return { resources: toResources(previous.body, previous.at, now, { agent, provider }), available: true, reason: 'ok',
      freshAt: new Date(previous.at).toISOString(), stale: false, failed: false, cached: true };
  }

  const fetch = fetchFn || injectedFetch || defaultFetch;
  const fetched = await fetch(token);
  if (!fetched.ok) {
    // A provider/credential switch invalidates the old LKG. Serving the previous account's quota
    // after a failed refresh would be a cross-account display bug, not a safe stale value.
    if (previous?.body && sameCredential) {
      cache.set(key, { ...previous, readFailed: true, at: now });
      return { resources: toResources(previous.body, previous.at, now, { agent, provider }), available: true, reason: fetched.reason,
        freshAt: new Date(previous.at).toISOString(), stale: true, failed: true };
    }
    return { resources: [], available: false, reason: fetched.reason ?? 'fetch_failed', freshAt: null, stale: false, failed: true };
  }
  cache.set(key, { at: now, credentialSig, body: fetched.body, readFailed: false });
  return { resources: toResources(fetched.body, now, now, { agent, provider }), available: true, reason: 'ok',
    freshAt: new Date(now).toISOString(), stale: false, failed: false };
}
