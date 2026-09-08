import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectPiResourceSnapshot, resetPiResourceCache } from '../src/resources/piApiUsage.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pi-resource-'));
  fs.mkdirSync(path.join(home, 'agent', 'sessions', 'one'), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function line(value) { return `${JSON.stringify(value)}\n`; }
function localTimes() {
  const now = new Date(2026, 8, 8, 12, 0, 0, 0);
  return { now, yesterday: new Date(2026, 8, 7, 23, 59, 0), today: new Date(2026, 8, 8, 9, 0, 0) };
}
function assistant(timestamp, totalTokens) { return { type: 'message', timestamp: timestamp.toISOString(), message: { role: 'assistant', usage: { totalTokens } } }; }

test('Pi API usage uses local midnight, aggregates sessions, and skips partial/malformed records', (t) => {
  resetPiResourceCache(); const home = fixture(t); const times = localTimes();
  const first = path.join(home, 'agent', 'sessions', 'one', 'a.jsonl');
  fs.writeFileSync(first, line({ type: 'session', id: 'a' }) + line({ type: 'model_change', provider: 'deepseek' })
    + line(assistant(times.yesterday, 100)) + line(assistant(times.today, 120)) + '{"type":"message"');
  const secondDir = path.join(home, 'agent', 'sessions', 'two'); fs.mkdirSync(secondDir);
  fs.writeFileSync(path.join(secondDir, 'b.jsonl'), line({ type: 'session', id: 'b' }) + line({ type: 'model_change', provider: 'deepseek' }) + line(assistant(times.today, 30)) + 'not-json');
  const result = collectPiResourceSnapshot({ source: { path: home }, revision: 'r1', now: times.now.getTime() });
  assert.equal(result.totalTokens, 150); assert.equal(result.trustedApiResponses, 2); assert.equal(result.provenance.files, 2);
  assert.strictEqual(collectPiResourceSnapshot({ source: { path: home }, revision: 'r1', now: times.now.getTime() }), result);
});

test('Pi provider changes are classified per assistant response and subscription/unknown are excluded', (t) => {
  resetPiResourceCache(); const home = fixture(t); const times = localTimes();
  const file = path.join(home, 'agent', 'sessions', 'one', 'mixed.jsonl');
  fs.writeFileSync(file, line({ type: 'model_change', provider: 'deepseek' }) + line(assistant(times.today, 10))
    + line({ type: 'model_change', provider: 'opencode-go' }) + line(assistant(new Date(times.today.getTime() + 1000), 20))
    + line({ type: 'model_change', provider: 'mystery-provider' }) + line(assistant(new Date(times.today.getTime() + 2000), 30)));
  const result = collectPiResourceSnapshot({ source: { path: home }, revision: 'r2', now: times.now.getTime() });
  assert.deepEqual([result.totalTokens, result.trustedApiResponses, result.excludedSubscriptionResponses, result.excludedUnknownResponses], [10, 1, 1, 1]);
});

test('YAPI is API only with explicit structured API route config', (t) => {
  resetPiResourceCache(); const home = fixture(t); const times = localTimes();
  fs.writeFileSync(path.join(home, 'agent', 'models.json'), JSON.stringify({ providers: { YAPI: { baseUrl: 'https://example.test', api: 'anthropic-messages' } } }));
  fs.writeFileSync(path.join(home, 'agent', 'sessions', 'one', 'y.jsonl'), line({ type: 'model_change', provider: 'YAPI' }) + line(assistant(times.today, 77)));
  assert.equal(collectPiResourceSnapshot({ source: { path: home }, revision: 'r3', now: times.now.getTime() }).totalTokens, 77);
});
