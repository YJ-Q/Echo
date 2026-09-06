const SOURCE_VERSION = 'codex_jsonl_rate_limits_v1';

function finitePercent(value) {
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
}
function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// This boundary deliberately normalizes an instantaneous quota snapshot, never
// token telemetry. Each window is a separate resource record.
export function normalizeCodexQuotaSnapshot(snapshot) {
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
    return [{ ...common, ...optional, windowDurationMinutes, percentUsed, resetsAt }];
  });
}
