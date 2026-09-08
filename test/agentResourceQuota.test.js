import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readLatestCodexQuotaSnapshot } from '../src/resources/codexQuotaSource.js';
import { normalizeCodexQuotaSnapshot } from '../src/resources/normalizeAgentResource.js';
import { getAgentResourceStatus } from '../src/resources/agentResourceService.js';

function record(timestamp, primary = 59, secondary = 51) {
  const rate_limits = { primary: { used_percent: primary, window_minutes: 300, resets_at: 1_800_000_001 } };
  if (secondary !== null) rate_limits.secondary = { used_percent: secondary, window_minutes: 10080, resets_at: 1_800_000_002 };
  return JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', rate_limits } });
}
function sourceRoot(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-resource-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, contents);
  }
  return root;
}

test('Codex quota source selects the globally newest trusted snapshot, including across active/archive duplicates', (t) => {
  const root = sourceRoot(t, {
    'sessions/a.jsonl': `${record('2026-09-06T10:00:00.000Z', 12, 20)}\n${record('2026-09-06T11:00:00.000Z', 59, 51)}`,
    'archived_sessions/a.jsonl': record('2026-09-06T11:00:00.000Z', 59, 51),
    'archived_sessions/old.jsonl': record('2026-09-06T09:00:00.000Z', 99, 99)
  });
  const snapshot = readLatestCodexQuotaSnapshot(root);
  assert.equal(snapshot.timestamp.toISOString(), '2026-09-06T11:00:00.000Z');
  const resources = normalizeCodexQuotaSnapshot(snapshot);
  assert.deepEqual(resources.map(({ windowDurationMinutes, percentUsed }) => [windowDurationMinutes, percentUsed]), [[300, 59], [10080, 51]]);
  assert.equal(resources[0].resetsAt, 1_800_000_001);
});

test('Codex quota source fail-soft skips malformed records and supports only primary', (t) => {
  const root = sourceRoot(t, { 'sessions/a.jsonl': `{bad json}\n${JSON.stringify({ timestamp: 'invalid', type: 'event_msg', payload: { type: 'token_count', rate_limits: {} } })}\n${record('2026-09-06T11:00:00.000Z', 0, null)}` });
  const resources = normalizeCodexQuotaSnapshot(readLatestCodexQuotaSnapshot(root));
  assert.deepEqual(resources.map((resource) => [resource.windowDurationMinutes, resource.percentUsed]), [[300, 0]]);
});

test('normalization preserves quota boundaries and never labels the seven-day rolling window as a week', () => {
  const normalized = normalizeCodexQuotaSnapshot({ timestamp: new Date('2026-09-06T11:00:00.000Z'), rateLimits: { primary: { used_percent: 0, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 100, window_minutes: 10080, resets_at: 2 } } });
  assert.deepEqual(normalized.map((item) => item.percentUsed), [0, 100]);
  assert.equal(normalized[1].windowDurationMinutes, 10080);
  assert.ok(!JSON.stringify(normalized).includes('week'));
});

test('missing source remains unavailable and Claude remains unavailable', (t) => {
  const root = sourceRoot(t, {});
  assert.equal(readLatestCodexQuotaSnapshot(root), null);
  const status = getAgentResourceStatus({ readLatestSnapshot: () => null });
  assert.deepEqual(status.agents.map((agent) => [agent.agent, Boolean(agent.unavailable)]), [['codex', true], ['claude-code', true]]);
});

test('S7 quota normalization: remaining = 100 - used when the window is valid', () => {
  const normalized = normalizeCodexQuotaSnapshot(
    { timestamp: new Date('2026-09-07T12:00:00.000Z'), rateLimits: { primary: { used_percent: 72, window_minutes: 10080, resets_at: 1789198548 } } },
    { now: Date.parse('2026-09-07T12:00:00.000Z') });
  assert.deepEqual(normalized.map((w) => [w.percentUsed, w.remaining, w.stale]), [[72, 28, false]]);
});

test('S7 service quota: expired snapshot is stale/null, fresh snapshot restores remaining', () => {
  const snapshot = { timestamp: new Date('2026-09-07T12:35:47.000Z'), rateLimits: {
    primary: { used_percent: 22, window_minutes: 300, resets_at: 1788787981 },   // 2026-09-07T13:33:01Z
    secondary: { used_percent: 72, window_minutes: 10080, resets_at: 1789198548 }, // 2026-09-12T07:35:48Z
  } };
  // 5h window already rolled (now 18:00Z > resets 13:33Z) and the newest snapshot predates the
  // reset, so there is no trusted value for the CURRENT 5h window: never show the old 22% nor guess
  // a fresh 100%. The 7d window is still inside its window -> remaining 100 - 72 = 28.
  const expired = getAgentResourceStatus({ readLatestSnapshot: () => snapshot, revision: 'r1', now: Date.parse('2026-09-07T18:00:00.000Z') });
  const windows = expired.agents.find((a) => a.agent === 'codex').resources;
  assert.deepEqual(windows.map((w) => [w.windowDurationMinutes, w.remaining, w.stale]), [[300, null, true], [10080, 28, false]]);

  // Provider emits a fresh post-reset 5h snapshot: remaining restored to 100, stale cleared.
  const fresh = getAgentResourceStatus({ readLatestSnapshot: () => ({
    timestamp: new Date('2026-09-07T14:00:00.000Z'),
    rateLimits: {
      primary: { used_percent: 0, window_minutes: 300, resets_at: 1788787981 },
      secondary: { used_percent: 72, window_minutes: 10080, resets_at: 1789198548 },
    },
  }), revision: 'r2', now: Date.parse('2026-09-07T14:30:00.000Z') });
  const freshWindows = fresh.agents.find((a) => a.agent === 'codex').resources;
  assert.deepEqual(freshWindows.map((w) => [w.windowDurationMinutes, w.remaining, w.stale]), [[300, 100, false], [10080, 28, false]]);
});
