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
