import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCodexUsageIngest, sourceIdForHome } from '../src/telemetry/codexUsageIngest.js';
import { buildUsageRecord } from '../src/telemetry/codexUsageRecord.js';
import { loadUsageRecords, filterRecords, summarize } from '../src/telemetry/costLedger.js';
import { deriveCost, readPriceTable, rateRowFor } from '../src/telemetry/priceTable.js';
import { usageLogPath } from '../src/telemetry/paths.js';
import { runCostCli } from '../src/cli/margin/runCostCli.js';

// Real Codex JSONL shapes (confirmed 2026-09-07). A usage fixture is exactly what the S3/S4 native
// schema produces: one `token_usage_record` per request with per-request `usage` plus cumulative
// sidecars; model/provider come only from the rollout's leading `session_meta`.
const USAGE = (n) => ({ input_tokens: n.input ?? 0, cached_input_tokens: n.cached ?? 0, cache_write_input_tokens: n.cacheWrite ?? 0, output_tokens: n.output ?? 0, reasoning_output_tokens: n.reasoning ?? 0, total_tokens: n.total ?? (n.input ?? 0) + (n.output ?? 0) });
function sessionMeta(sessionId, { model = 'GPT-5.2', provider = 'openai' } = {}) {
  return JSON.stringify({ timestamp: '2026-09-07T00:00:00.000Z', ordinal: 0, type: 'session_meta',
    payload: { session_id: sessionId, id: sessionId, model_provider: provider, base_instructions: { text: `You are Codex, based on ${model}.` } } });
}
function usageRecord(sessionId, respId, ts, u) {
  return JSON.stringify({ timestamp: ts, ordinal: 0, type: 'token_usage_record',
    payload: { thread_id: sessionId, turn_id: `${sessionId}-turn`, session_id: sessionId, root_turn_id: `${sessionId}-turn`, response_id: respId, usage: USAGE(u), thread_token_usage: USAGE({ input: (u.input ?? 0), total: (u.input ?? 0) + (u.output ?? 0) }) } });
}
function rolloutContent(sessionId, records) {
  return records.map((r) => r.line).join('\n') + (records.length ? '\n' : '');
}

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cost-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function writeActive(home, name, content) {
  const full = path.join(home, 'sessions', '2026', '09', '07', name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}
function writeArchived(home, name, content) {
  const full = path.join(home, 'archived_sessions', name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}
const tok = (input, extra = {}) => ({ input, output: extra.output ?? 10, cached: extra.cached ?? 0, reasoning: extra.reasoning ?? 0, total: extra.total ?? input + (extra.output ?? 10) });

test('S4: one provider token_usage_record -> one persisted usage record (verbatim fields)', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100, { cached: 40, output: 20, reasoning: 5, total: 120 })) },
  ]));
  const sourceId = sourceIdForHome(home);
  const ingest = createCodexUsageIngest({ dir, sourceId });
  const result = ingest.catchUp(home);
  assert.equal(result.written, 1);
  const { records, stats } = loadUsageRecords({ dir });
  assert.equal(stats.unique, 1);
  const rec = records[0];
  assert.equal(rec.v, 1); assert.equal(rec.kind, 'usage'); assert.equal(rec.agent, 'codex');
  assert.equal(rec.sourceId, sourceId);
  assert.equal(rec.provider, 'openai');
  assert.equal(rec.model, 'GPT-5.2');
  assert.equal(rec.modelProvenance, 'codex_session_meta.base_instructions');
  assert.equal(rec.sessionId, 'S1'); assert.equal(rec.threadId, 'S1'); assert.equal(rec.responseId, 'resp_1');
  assert.equal(rec.ts, '2026-09-07T10:00:01.000Z');
  assert.ok(rec.capturedAt);
  // verbatim bucket numbers
  assert.deepEqual(rec.usage, { input: 100, cachedInput: 40, cacheWriteInput: 0, output: 20, reasoningOutput: 5, total: 120 });
  assert.ok(rec.threadUsage, 'cumulative sidecar retained (audit only)');
  assert.equal(rec.provenance.role, 'active');
});

test('S4: catch-up rerun writes zero new records; restart (fresh process) keeps totals identical', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100)) },
    { line: usageRecord('S1', 'resp_2', '2026-09-07T10:00:02.000Z', tok(50)) },
  ]));
  const sourceId = sourceIdForHome(home);
  const a = createCodexUsageIngest({ dir, sourceId });
  assert.equal(a.catchUp(home).written, 2);
  // rerun (same process): offsets already advanced, so it adds nothing
  const again = a.catchUp(home);
  assert.equal(again.written, 0);
  // "restart": a brand new ingestor (offsets reset) over the same store must add nothing (dedup)
  const b = createCodexUsageIngest({ dir, sourceId });
  const restart = b.catchUp(home);
  assert.equal(restart.written, 0);
  assert.equal(restart.skippedDups, 2, 'restart rescan hits only already-persisted records');
  assert.equal(loadUsageRecords({ dir }).records.length, 2);
});

test('S4: active -> archive move ingests once, never duplicates', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  const active = writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100)) },
  ]));
  const sourceId = sourceIdForHome(home);
  const ingest = createCodexUsageIngest({ dir, sourceId });
  assert.equal(ingest.catchUp(home).written, 1);
  // move to archived_sessions, then a later catch-up re-sees it from the archived tree
  const archivedName = path.basename(active);
  const content = fs.readFileSync(active, 'utf8');
  fs.rmSync(active);
  writeArchived(home, archivedName, content);
  const second = createCodexUsageIngest({ dir, sourceId });
  const result = second.catchUp(home);
  assert.equal(result.written, 0, 'archived copy must not duplicate an already-ingested record');
  assert.equal(loadUsageRecords({ dir }).records.length, 1);
});

test('S4: duplicate response_id across rollouts persists only once', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_dup', '2026-09-07T10:00:01.000Z', tok(100)) },
  ]));
  writeActive(home, 'rollout-2026-09-07T10-00-05-B.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_dup', '2026-09-07T10:00:01.000Z', tok(100)) },
  ]));
  const sourceId = sourceIdForHome(home);
  const ingest = createCodexUsageIngest({ dir, sourceId });
  const result = ingest.catchUp(home);
  assert.equal(result.written, 1, 'one request persisted even when it appears in two rollouts');
  assert.equal(result.skippedDups, 1);
  assert.equal(loadUsageRecords({ dir }).records.length, 1);
});

test('S4: a partial trailing native line is never written, then completes on the next tail', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  const rec1 = usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100));
  const rec2 = usageRecord('S1', 'resp_2', '2026-09-07T10:00:02.000Z', tok(50));
  const file = writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [{ line: sessionMeta('S1') }, { line: rec1 }]) + rec2.slice(0, rec2.length - 6)); // truncated, no newline
  const sourceId = sourceIdForHome(home);
  const ingest = createCodexUsageIngest({ dir, sourceId });
  const first = ingest.catchUp(home);
  assert.equal(first.written, 1, 'only the complete record is persisted');
  assert.equal(loadUsageRecords({ dir }).records.length, 1);
  // Native write finishes the previously-partial line
  fs.appendFileSync(file, rec2.slice(-6) + '\n');
  const tailed = ingest.tail(home);
  assert.equal(tailed.written, 1, 'the completed line is picked up incrementally');
  assert.equal(loadUsageRecords({ dir }).records.length, 2);
});

test('S4: unknown model / missing price row is clearly unpriced, never estimated', (t) => {
  const dir = tmp(t);
  const table = readPriceTable(dir, { create: true }); // empty seed
  const priced = deriveCost({ provider: 'openai', model: 'GPT-5.2', usage: { input: 100, cachedInput: 0, output: 20, total: 120 } }, table);
  assert.equal(priced.priced, false);
  assert.equal(priced.reason, 'no_rate');
  const noModel = deriveCost({ provider: 'openai', model: null, usage: { input: 1, output: 1, total: 2 } }, table);
  assert.equal(noModel.priced, false);
  assert.equal(noModel.reason, 'unknown_model');
});

test('S4: cost derivation is exact and bucketwise against a configured price row', (t) => {
  const dir = tmp(t);
  const table = readPriceTable(dir, { create: true });
  table.prices = [{ provider: 'openai', model: 'GPT-5.2', currency: 'USD', inputPerM: 1.25, cachedInputPerM: 0.1, cacheWriteInputPerM: 1.25, outputPerM: 10 }];
  assert.ok(rateRowFor(table, { provider: 'openai', model: 'GPT-5.2' }));
  // input 1_000_000 * 1.25 = 1.25 ; output 100_000 * 10 = 1.0 ; reasoning 5k folded in output (not double billed)
  const rec = { provider: 'openai', model: 'GPT-5.2', usage: { input: 1_000_000, cachedInput: 0, cacheWriteInput: 0, output: 100_000, reasoningOutput: 5_000, total: 1_100_000 } };
  const derived = deriveCost(rec, table);
  assert.equal(derived.priced, true);
  assert.ok(Math.abs(derived.cost - 2.25) < 1e-9, `expected 2.25, got ${derived.cost}`);
  assert.equal(derived.currency, 'USD');
});

test('S4: aggregation by session/model is exact (CLI equals ledger raw hand count)', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1', { model: 'GPT-5.2' }) },
    { line: usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100, { output: 20, total: 120 })) },
    { line: usageRecord('S1', 'resp_2', '2026-09-07T10:00:02.000Z', tok(50, { output: 10, total: 60 })) },
  ]));
  writeActive(home, 'rollout-2026-09-07T11-00-00-B.jsonl', rolloutContent('S2', [
    { line: sessionMeta('S2', { model: 'GPT-6' }) },
    { line: usageRecord('S2', 'resp_3', '2026-09-07T11:00:01.000Z', tok(20, { output: 4, total: 24 })) },
  ]));
  const sourceId = sourceIdForHome(home);
  createCodexUsageIngest({ dir, sourceId }).catchUp(home);
  const { records } = loadUsageRecords({ dir });
  assert.equal(records.length, 3);
  // Hand count: model filter GPT-5.2 -> req 2, total 180; GPT-6 -> req 1, total 24
  const gpt5 = summarize(filterRecords(records, { models: ['GPT-5.2'] }), null, 'none').overall;
  assert.equal(gpt5.requests, 2);
  assert.equal(gpt5.total, 180);
  assert.equal(gpt5.input, 150);
  const gpt6 = summarize(filterRecords(records, { models: ['GPT-6'] }), null, 'none').overall;
  assert.equal(gpt6.requests, 1);
  assert.equal(gpt6.total, 24);
  // CLI report over the fixture must agree
  const out = { s: '' };
  const cli = runCostCli(['report', '--group', 'none', '--dir', dir], { stdout: { write: (x) => { out.s += x; } }, stderr: { write: () => {} } });
  assert.equal(cli, 0);
  assert.ok(out.s.includes('requests            3'), out.s);
});

test('S4: store self-heals a trailing partial line in usage.jsonl', (t) => {
  const home = tmp(t);
  const dir = tmp(t);
  writeActive(home, 'rollout-2026-09-07T10-00-00-A.jsonl', rolloutContent('S1', [
    { line: sessionMeta('S1') },
    { line: usageRecord('S1', 'resp_1', '2026-09-07T10:00:01.000Z', tok(100)) },
  ]));
  const sourceId = sourceIdForHome(home);
  createCodexUsageIngest({ dir, sourceId }).catchUp(home);
  // simulate a crash mid-append on the store's own log
  const log = usageLogPath(dir);
  fs.appendFileSync(log, '{"v":1,"kind":"usage","partial":'); // no trailing newline
  const { records } = loadUsageRecords({ dir });
  assert.equal(records.length, 1, 'partial store line ignored on read');
  // next catch-up repairs it and keeps totals
  const ingest = createCodexUsageIngest({ dir, sourceId });
  ingest.catchUp(home);
  const raw = fs.readFileSync(log, 'utf8');
  assert.ok(raw.endsWith('\n'), 'log repaired to end on a newline');
  assert.equal(loadUsageRecords({ dir }).records.length, 1);
});
