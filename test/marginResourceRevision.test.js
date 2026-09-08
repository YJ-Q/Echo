import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexLiveResourceReader } from '../src/resources/codexLiveResource.js';
import { getAgentResourceStatus } from '../src/resources/agentResourceService.js';

// Real Codex JSONL shapes (confirmed 2026-09-07): token_usage_record (per-request usage) is
// adjacent to event_msg/token_count (rate_limits quota + info.total_token_usage cumulative).

const USAGE = (n) => ({ input_tokens: n.input ?? 0, cached_input_tokens: n.cached ?? 0, cache_write_input_tokens: n.cacheWrite ?? 0, output_tokens: n.output ?? 0, reasoning_output_tokens: n.reasoning ?? 0, total_tokens: n.total ?? (n.input ?? 0) + (n.output ?? 0) });
function sessionMeta(sessionId, { threadSource = 'user', model = 'GPT-5.2' } = {}) {
  return JSON.stringify({ timestamp: '2026-09-07T00:00:00.000Z', ordinal: 0, type: 'session_meta',
    payload: { session_id: sessionId, id: sessionId, cwd: 'D:\\w', thread_source: threadSource, model_provider: 'openai', base_instructions: { text: `You are Codex, based on ${model}.` } } });
}
function tokenUsage(sessionId, respId, ts, u, threadTotal) {
  return JSON.stringify({ timestamp: ts, type: 'token_usage_record', payload: { thread_id: `${sessionId}-th`, turn_id: `${sessionId}-turn`, session_id: sessionId, root_turn_id: 'R', response_id: respId, usage: USAGE(u), thread_token_usage: USAGE(threadTotal) } });
}
function tokenCount(sessionId, ts, totals, ratePct, secondary = 40) {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: USAGE(totals), last_token_usage: USAGE(totals), model_context_window: 258400 },
    rate_limits: { limit_id: 'codex', plan_type: 'plus', primary: { used_percent: ratePct, window_minutes: 300, resets_at: 1788611748 }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1789198548 }, credits: { has_credits: false, unlimited: false, balance: '0' } } } });
}
function turn(sessionId, respId, ts, perRequest, totals, ratePct) {
  return `${tokenUsage(sessionId, respId, ts, perRequest, totals)}\n${tokenCount(sessionId, ts, totals, ratePct)}\n`;
}

function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-resource-live-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function writeRollout(dir, name, content) { const full = path.join(dir, 'sessions', '2026', '09', '07', name); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); return full; }
function appendRollout(full, content) { fs.appendFileSync(full, content); return full; }

test('S3 reader: token usage + quota derive from the same provider token_count, kept separate', (t) => {
  const dir = root(t);
  const file = writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1')}\n${turn('USER1', 'resp1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, cached: 40, output: 20, reasoning: 5, total: 165 }, 12)}`);
  const reader = createCodexLiveResourceReader();
  const view = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(view.cached, false);
  assert.equal(view.stale, false);
  // quota from rate_limits
  assert.ok(view.quotaSnapshot, 'quota LKG present');
  assert.equal(view.quotaSnapshot.rateLimits.primary.used_percent, 12);
  // token usage separate, cumulative provider totals
  assert.ok(view.token, 'token usage present');
  assert.equal(view.token.resourceType, 'tokenUsage');
  assert.equal(view.token.sessionId, 'USER1');
  assert.equal(view.token.totalTokens, 165);
  assert.equal(view.token.inputTokens, 100);
  assert.equal(view.token.cachedInputTokens, 40);
  assert.equal(view.token.reasoningTokens, 5);
  assert.equal(view.token.responseId, 'resp1');
  assert.equal(view.token.model, 'GPT-5.2');
  assert.ok(!('percentUsed' in view.token), 'token record is not a quota window (never summed)');
});

test('S3 reader: append advances on a new revision; unchanged revision never rescans', (t) => {
  const dir = root(t);
  const file = writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1')}\n${turn('USER1', 'resp1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, output: 20, total: 120 }, 12)}`);
  const reader = createCodexLiveResourceReader();
  const first = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(first.token.totalTokens, 120);
  assert.equal(first.quotaSnapshot.rateLimits.primary.used_percent, 12);

  // A change written but still under the OLD revision must be ignored (cached, no re-read).
  appendRollout(file, turn('USER1', 'resp2', '2026-09-07T10:00:05.000Z', { input: 50, output: 9 }, { input: 150, output: 29, total: 179 }, 25));
  const cached = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(cached.cached, true);
  assert.equal(cached.token.totalTokens, 120, 'unchanged revision returns cached view');
  assert.equal(cached.quotaSnapshot.rateLimits.primary.used_percent, 12);

  // Advancing the revision reads only the appended delta and reflects the newer snapshot.
  const next = reader.snapshot({ codexHome: dir, revision: 'r2' });
  assert.equal(next.token.totalTokens, 179);
  assert.equal(next.quotaSnapshot.rateLimits.primary.used_percent, 25);
});

test('S3 reader: a partial trailing JSONL line never pollutes token or quota state', (t) => {
  const dir = root(t);
  const file = writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1')}\n${turn('USER1', 'resp1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, output: 20, total: 120 }, 12)}`);
  const reader = createCodexLiveResourceReader();
  const first = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(first.token.totalTokens, 120);

  // Append a PARTIAL newer token_count (no trailing newline) claiming a huge total.
  const partial = tokenCount('USER1', '2026-09-07T10:00:09.000Z', { input: 9999, output: 9999, total: 99999 }, 95);
  appendRollout(file, partial);
  const unchanged = reader.snapshot({ codexHome: dir, revision: 'r2' });
  assert.equal(unchanged.token.totalTokens, 120, 'partial line must not advance token state');
  assert.equal(unchanged.quotaSnapshot.rateLimits.primary.used_percent, 12, 'partial line must not advance quota state');

  // Once the line is completed (newline) it is parsed.
  appendRollout(file, '\n');
  const completed = reader.snapshot({ codexHome: dir, revision: 'r3' });
  assert.equal(completed.token.totalTokens, 99999);
  assert.equal(completed.quotaSnapshot.rateLimits.primary.used_percent, 95);
});

test('S3 reader: a subagent/control rollout never preempts the user session token state', (t) => {
  const dir = root(t);
  // User file written first (older), subagent file written second (newer mtime).
  writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1', { threadSource: 'user' })}\n${turn('USER1', 'ru1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, output: 20, total: 120 }, 12)}`);
  const sub = writeRollout(dir, 'rollout-2026-09-07T11-00-00-SUBAGENT1.jsonl', `${sessionMeta('SUB1', { threadSource: 'subagent' })}\n${turn('SUB1', 'rs1', '2026-09-07T11:00:01.000Z', { input: 1, output: 1 }, { input: 999, output: 999, total: 999999 }, 88)}`);
  // Ensure subagent has the newest mtime.
  fs.utimesSync(sub, new Date(), new Date(Date.now() + 2000));
  const reader = createCodexLiveResourceReader();
  const view = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(view.token.sessionId, 'USER1', 'token state tracks the user session, not the newer subagent');
  assert.equal(view.token.totalTokens, 120);
});

test('S3 reader: quota stays last-known-good (not unavailable) when the live session is archived', (t) => {
  const dir = root(t);
  const user = writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1')}\n${turn('USER1', 'resp1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, output: 20, total: 120 }, 12)}`);
  const reader = createCodexLiveResourceReader();
  const first = reader.snapshot({ codexHome: dir, revision: 'r1' });
  assert.equal(first.quotaSnapshot.rateLimits.primary.used_percent, 12);
  assert.equal(first.token.totalTokens, 120);

  // Archive/delete the live session out of the active tree (mirrors a Codex archive/delete).
  fs.rmSync(user);
  const after = reader.snapshot({ codexHome: dir, revision: 'r2' });
  assert.ok(after.quotaSnapshot, 'quota is retained as last-known-good after archive');
  assert.equal(after.quotaSnapshot.rateLimits.primary.used_percent, 12, 'quota does not flash to unavailable');
});

test('S3 service: DTO keeps revision/freshAt/stale and separates token from 5h/7d quota', (t) => {
  const dir = root(t);
  writeRollout(dir, 'rollout-2026-09-07T10-00-00-USER1.jsonl', `${sessionMeta('USER1')}\n${turn('USER1', 'resp1', '2026-09-07T10:00:01.000Z', { input: 100, output: 20 }, { input: 100, output: 20, total: 120 }, 12)}`);
  const reader = createCodexLiveResourceReader();
  const status = getAgentResourceStatus({ codexHome: dir, source: { path: dir }, revision: 'revX', reader });
  const codex = status.agents.find((a) => a.agent === 'codex');
  assert.equal(codex.unavailable, undefined, 'codex available');
  assert.equal(codex.stale, false);
  assert.equal(codex.revision, 'revX');
  assert.ok(codex.freshAt);
  // quota windows are in resources (unchanged semantic);
  const windows = codex.resources.filter((r) => r.resourceType === 'quota');
  assert.deepEqual(windows.map((w) => [w.windowDurationMinutes, w.percentUsed]), [[300, 12], [10080, 40]]);
  // token usage is a separate record
  assert.equal(codex.token.resourceType, 'tokenUsage');
  assert.equal(codex.token.sessionId, 'USER1');
  assert.equal(codex.token.totalTokens, 120);
  const claude = status.agents.find((a) => a.agent === 'claude-code');
  assert.equal(claude.unavailable, true);
});
