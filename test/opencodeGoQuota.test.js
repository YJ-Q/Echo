import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGoQuotaResources, resetOpenCodeGoQuotaCache, resolveOpenCodeGoCredential } from '../src/resources/opencodeGoQuota.js';
import { adapterFor } from '../src/agents/adapters.js';
import { resetPiResourceCache } from '../src/resources/piApiUsage.js';

const SECRET = 'test-opencode-go-sentinel-not-a-credential';
const NOW = Date.parse('2026-09-08T06:00:00.000Z');
const OK = (percent, resetsAt, status = 'ok') => ({ status, percent, resetsAt });
const bodyOf = (usage) => ({ usage });

function homeWithCred(secret = SECRET) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goq-'));
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent', 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api_key', key: secret } }));
  return dir;
}
function plainHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'goq-plain-')); }

test('Go quota: success maps used% to remaining and the real 5h/7d/M windows', async () => {
  const home = homeWithCred();
  const fetchFn = async () => ({ ok: true, body: bodyOf({
    rolling: OK(14, '2026-09-08T10:36:05.906Z'),
    weekly: OK(7, '2026-09-14T00:00:00.000Z'),
    monthly: OK(3, '2026-10-07T16:11:13.906Z'),
  }) });
  const res = await readGoQuotaResources({ home, now: NOW, fetchFn });
  assert.equal(res.available, true); assert.equal(res.failed, false); assert.equal(res.stale, false);
  assert.equal(res.resources.length, 3);
  const windows = res.resources.map(r => [r.window, r.windowDurationMinutes, r.percentUsed, r.remaining]);
  assert.deepEqual(windows, [['5h', 300, 14, 86], ['7d', 10080, 7, 93], ['M', 43200, 3, 97]], 'used 14->86, 7->93, 3->97');
  assert.equal(res.resources[0].accessMode, 'subscription');
  assert.equal(res.resources[0].resourceType, 'quota');
  assert.equal(res.resources[0].resetsAt, Math.floor(Date.parse('2026-09-08T10:36:05.906Z') / 1000));
  assert.equal(res.resources[0].status, 'ok');
});

test('Go quota: used 100 / 100+ -> remaining 0; fresh 0% stays explicit', async () => {
  const home = homeWithCred();
  const fetchFn = async () => ({ ok: true, body: bodyOf({
    rolling: OK(100, '2026-09-08T10:36:05.906Z'),
    weekly: OK(120, '2026-09-14T00:00:00.000Z'),
    monthly: OK(0, '2026-10-07T16:11:13.906Z'),
  }) });
  const res = await readGoQuotaResources({ home, now: NOW, fetchFn });
  assert.deepEqual(res.resources.map(r => r.remaining), [0, 0, 100], 'used 100 -> 0 remaining; used 120 -> clamped 0; used 0 -> 100');
});

test('Go quota: a missing window is omitted, not invented', async () => {
  const home = homeWithCred();
  const fetchFn = async () => ({ ok: true, body: bodyOf({ rolling: OK(14, '2026-09-08T10:36:05.906Z') }) });
  const res = await readGoQuotaResources({ home, now: NOW, fetchFn });
  assert.deepEqual(res.resources.map(r => r.window), ['5h']);
});

test('Go quota: an expired snapshot without a fresh refresh is stale — never a guessed 100', async () => {
  const home = homeWithCred();
  const beforeReset = Date.parse('2026-09-08T05:00:00.000Z');
  const afterReset = Date.parse('2026-09-08T12:00:00.000Z'); // past rolling resetsAt
  const first = async () => ({ ok: true, body: bodyOf({
    rolling: OK(14, '2026-09-08T10:36:05.906Z'),
    weekly: OK(7, '2026-09-14T00:00:00.000Z'),
  }) });
  await readGoQuotaResources({ home, now: beforeReset, fetchFn: first });
  // Window rolled; refresh now fails -> LKG is retained but marked stale, expired window -> null.
  const second = async () => ({ ok: false, reason: 'http_500' });
  const res = await readGoQuotaResources({ home, now: afterReset, fetchFn: second });
  const rolling = res.resources.find(r => r.window === '5h');
  const weekly = res.resources.find(r => r.window === '7d');
  assert.equal(res.stale, true); assert.equal(res.failed, true);
  assert.equal(rolling.stale, true);
  assert.equal(rolling.remaining, null, 'expired window has no trusted remaining -> not a guessed 100');
  assert.equal(weekly.stale, false); assert.equal(weekly.remaining, 93, 'non-expired window keeps its trusted remaining');
});

test('Go quota: no credential => unavailable, no fetch attempted, resources empty', async () => {
  const home = plainHome();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { ok: true, body: bodyOf({ rolling: OK(14, '2026-09-08T10:36:05.906Z') }) }; };
  const res = await readGoQuotaResources({ home, now: NOW, fetchFn });
  assert.equal(res.available, false); assert.equal(res.reason, 'no_credential');
  assert.deepEqual(res.resources, []);
  assert.equal(calls, 0, 'no credential must not trigger a network request');
  assert.equal(resolveOpenCodeGoCredential(home), null);
});

test('Go quota: transient failure — no LKG -> unavailable; with LKG -> last trusted + stale', async () => {
  const home = homeWithCred();
  const fail = async () => ({ ok: false, reason: 'network' });
  const noLkg = await readGoQuotaResources({ home, now: NOW, fetchFn: fail });
  assert.equal(noLkg.available, false); assert.equal(noLkg.reason, 'network');
  assert.deepEqual(noLkg.resources, [], 'no LKG -> no quota window, unavailable');

  // With LKG: seed a trustable snapshot, then a failure past the refresh interval keeps it stale.
  resetOpenCodeGoQuotaCache();
  const good = async () => ({ ok: true, body: bodyOf({ rolling: OK(14, '2026-09-08T10:36:05.906Z') }) });
  await readGoQuotaResources({ home, now: NOW, fetchFn: good });
  const staleRes = await readGoQuotaResources({ home, now: NOW + 70_000, fetchFn: fail });
  assert.equal(staleRes.available, true); assert.equal(staleRes.stale, true);
  assert.equal(staleRes.resources.find(r => r.window === '5h').remaining, 86);
});

test('Go quota: LKG survives a transient failure and recovers fresh on restore', async () => {
  const home = homeWithCred();
  const good = async () => ({ ok: true, body: bodyOf({ rolling: OK(14, '2026-09-08T10:36:05.906Z') }) });
  await readGoQuotaResources({ home, now: NOW, fetchFn: good });
  const fail = async () => ({ ok: false, reason: 'network' });
  const staleRes = await readGoQuotaResources({ home, now: NOW + 70_000, fetchFn: fail });
  assert.equal(staleRes.available, true); assert.equal(staleRes.stale, true); assert.equal(staleRes.failed, true);
  assert.equal(staleRes.resources.find(r => r.window === '5h').remaining, 86, 'LKG keeps last trusted value');

  const again = async () => ({ ok: true, body: bodyOf({ rolling: OK(0, '2026-09-08T10:40:00.000Z') }) });
  const freshRes = await readGoQuotaResources({ home, now: NOW + 75_000, fetchFn: again });
  assert.equal(freshRes.stale, false); assert.equal(freshRes.failed, false);
  assert.equal(freshRes.resources.find(r => r.window === '5h').remaining, 100, 'restored -> fresh');
});

test('Go quota: within refresh interval serves cached snapshot without refetching; credential change forces refresh', async () => {
  const home = homeWithCred('key-A');
  let calls = [];
  const fetchFn = async (token) => { calls.push(token); return { ok: true, body: bodyOf({ rolling: OK(14, '2026-09-08T10:36:05.906Z') }) }; };
  await readGoQuotaResources({ home, now: NOW, fetchFn });
  const cached = await readGoQuotaResources({ home, now: NOW + 5000, fetchFn });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 1, 'within interval reuses cache, no refetch');

  // Change the credential -> signature changes -> forces refresh with the new key.
  fs.writeFileSync(path.join(home, 'agent', 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api_key', key: 'key-B' } }));
  await readGoQuotaResources({ home, now: NOW + 6000, fetchFn });
  assert.equal(calls.length, 2, 'credential change invalidates cache');
});

test('Go quota + Pi API Today merge: one Pi agent carries quota windows and API, credential never leaks', async () => {
  const home = homeWithCred();
  const mockFetch = async () => ({ ok: true, body: bodyOf({
    rolling: OK(14, '2026-09-08T10:36:05.906Z'),
    weekly: OK(7, '2026-09-14T00:00:00.000Z'),
    monthly: OK(3, '2026-10-07T16:11:13.906Z'),
  }) });
  const source = { path: home, sourceId: 'pi-test', id: 'pi-test', type: 'pi', enabled: true };
  const result = await adapterFor('pi').collectResourceSnapshot(source, { fetchGoQuota: mockFetch, now: NOW, revision: 'r' });
  assert.equal(result.ok, true); assert.equal(result.agents.length, 1);
  const agent = result.agents[0];
  assert.equal(agent.agent, 'pi');
  assert.equal(agent.subscriptionQuota, true, 'data-driven capability present only on verified quota');
  const quota = agent.resources.filter(r => r.accessMode === 'subscription');
  const api = agent.resources.filter(r => r.accessMode === 'api');
  assert.equal(quota.length, 3);
  assert.equal(api.length, 1);
  assert.equal(api[0].resourceType, 'tokenUsage'); assert.equal(api[0].scope, 'today');
  assert.doesNotMatch(JSON.stringify(agent), new RegExp(SECRET), 'credential must not appear in the DTO');
  assert.doesNotMatch(JSON.stringify(result), /api[_-]?key|"key"\s*:/i, 'no key-shaped field in the envelope');
});

test('Go quota failure or missing credential does not drop Pi API Today', async () => {
  const goFail = async () => ({ ok: false, reason: 'http_500' });
  const source = { path: homeWithCred(), sourceId: 'pi-test', id: 'pi-test', type: 'pi', enabled: true };
  const failed = await adapterFor('pi').collectResourceSnapshot(source, { fetchGoQuota: goFail, now: NOW, revision: 'r' });
  const failedAgent = failed.agents[0];
  assert.equal(failedAgent.subscriptionQuota, undefined, 'no subscriptionQuota claim on failure');
  assert.ok(failedAgent.resources.some(r => r.accessMode === 'api'), 'Go failure keeps API Today');

  const noCred = await adapterFor('pi').collectResourceSnapshot({ ...source, path: plainHome() }, { fetchGoQuota: goFail, now: NOW, revision: 'r' });
  assert.equal(noCred.agents[0].subscriptionQuota, undefined);
  assert.ok(noCred.agents[0].resources.some(r => r.accessMode === 'api'), 'no-credential keeps API Today');
});
