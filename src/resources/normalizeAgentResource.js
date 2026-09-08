const SOURCE_VERSION = 'codex_jsonl_rate_limits_v1';

function finitePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0) return null;
  // A provider-reported used-percent at/over the ceiling means the window is fully used: clamp to
  // 100 so it renders as "0% remaining" (exhausted truth), never dropped as though no window existed.
  return Math.min(100, percent);
}
function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// This boundary deliberately normalizes an instantaneous quota snapshot, never
// token telemetry. Each window is a separate resource record.
//
// Subscription quota is exposed as REMAINING (not used): `remaining = 100 - percentUsed`,
// with the window's own stale/expired handling. A snapshot that predates a window's reset
// (window already rolled, and no newer trusted snapshot exists — the reader always hands us
// the newest snapshot, so a pre-reset timestamp means exactly that) has no trusted value for
// the CURRENT window. We must not keep showing the expired window's used% nor guess a fresh
// 100%: the window is marked `stale: true` and `remaining: null`. Once a post-reset snapshot
// arrives, `now` is before/at the next reset and the real remaining is restored.
export function normalizeCodexQuotaSnapshot(snapshot, { now = Date.now() } = {}) {
  if (!snapshot || !(snapshot.timestamp instanceof Date) || Number.isNaN(snapshot.timestamp.getTime())) return [];
  const rateLimits = snapshot.rateLimits;
  if (!rateLimits || typeof rateLimits !== 'object') return [];
  const common = {
    agent: 'codex', provider: 'openai', accessMode: 'subscription', resourceType: 'quota',
    timestamp: snapshot.timestamp.toISOString(), provenance: 'codex_native_jsonl_event_msg.token_count.rate_limits',
    sourceVersion: SOURCE_VERSION, sourceStability: 'verified-native-snapshot'
  };
  const optional = {};
  if (typeof rateLimits.plan_type === 'string' && rateLimits.plan_type.trim()) optional.plan = rateLimits.plan_type;
  if (rateLimits.credits && typeof rateLimits.credits === 'object') optional.credits = rateLimits.credits;
  return ['primary', 'secondary'].flatMap((key) => {
    const window = rateLimits[key];
    const windowDurationMinutes = positiveInteger(window?.window_minutes);
    const percentUsed = finitePercent(window?.used_percent);
    const resetsAt = positiveInteger(window?.resets_at);
    if (windowDurationMinutes === null || percentUsed === null || resetsAt === null) return [];
    const snapshotMs = snapshot.timestamp.getTime();
    const resetMs = resetsAt * 1000;
    const expiredStale = now >= resetMs && snapshotMs < resetMs;
    const remaining = expiredStale ? null : Math.max(0, Math.round(100 - percentUsed));
    return [{ ...common, ...optional, windowDurationMinutes, percentUsed, remaining, resetsAt, stale: expiredStale }];
  });
}
