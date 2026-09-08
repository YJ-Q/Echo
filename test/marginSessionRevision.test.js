import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeSourceRevision, resetWorkspaceIdentityCache } from '../src/core/handoff/session-source.js';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';

function makeSource(id, home) {
  return { id, type: 'codex', name: 'Codex', path: home, origin: 'manual', enabled: true, supportLevel: 'Full support' };
}

function writeRollout(home, name, { archived = false, content } = {}) {
  const dir = archived ? path.join(home, 'archived_sessions') : path.join(home, 'sessions', '2026', '09', '07');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const body = content ?? `${JSON.stringify({ type: 'session_meta', payload: { session_id: 'native', cwd: home, thread_source: 'user' } })}\n`;
  fs.writeFileSync(file, body);
  return file;
}

async function listen(app) {
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('S2 source revision is stat-based, stable when unchanged, and changes exactly on a real source op', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s2-rev-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = makeSource('src-a', home);
  const rev = (codexHome = home, src = source) => computeSourceRevision({ codexHome, source: src });

  const initial = rev();
  assert.equal(rev(), initial, 'an unchanged active tree has a stable revision');
  assert.equal(rev(), initial, 'revision is deterministic across reads');

  // Native create (new active session) changes the revision.
  const file = writeRollout(home, 'rollout-2026-09-07T10-00-00-a.jsonl');
  const afterCreate = rev();
  assert.notEqual(afterCreate, initial, 'a new active session changes the revision');

  // Native update (append while a session continues) changes it.
  fs.appendFileSync(file, `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'more' }] } })}\n`);
  assert.notEqual(rev(), afterCreate, 'an active-session append changes the revision');

  // Non-rollout noise is not part of the default projection, so it must not change it.
  const stableAfterAppend = rev();
  fs.writeFileSync(path.join(home, 'sessions', '2026', '09', '07', 'scratch.tmp'), 'noise');
  assert.equal(rev(), stableAfterAppend, 'non-rollout writes leave the revision unchanged');

  // archived_sessions is never part of the default resumable projection: writing there must not
  // change the active-source revision.
  writeRollout(home, 'rollout-2026-09-07T11-00-00-archived.jsonl', { archived: true });
  assert.equal(rev(), stableAfterAppend, 'archived_sessions writes never change the active revision');

  // Archive (move out of the active tree) removes the item -> revision changes.
  const archivedDir = path.join(home, 'archived_sessions');
  fs.renameSync(file, path.join(archivedDir, 'rollout-archived-a.jsonl'));
  assert.notEqual(rev(), stableAfterAppend, 'an archive move changes the active revision');

  // Delete changes it too; and reverting to an empty active tree is deterministic.
  const beforeDelete = rev();
  const another = writeRollout(home, 'rollout-2026-09-07T12-00-00-b.jsonl');
  assert.notEqual(rev(), beforeDelete, 'creating another active session changes the revision');
  fs.rmSync(another);
  assert.equal(rev(), beforeDelete, 'deleting it returns to the prior revision');

  // A source/config switch changes the revision even when the physical tree is identical.
  const sourceB = makeSource('src-b', home);
  assert.notEqual(computeSourceRevision({ codexHome: home, source: sourceB }), rev(), 'an active-source switch changes the revision');
});

test('S2 GET /api/sessions/revision and /api/sessions expose a consistent live source revision', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s2-rev-http-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = makeSource('codex-src-rev', home);
  writeRollout(home, 'rollout-2026-09-07T10-00-00-a.jsonl');
  const app = createHandoffHttpAdapter({
    rootDir: home,
    readRegistry: () => ({ version: 1, sources: [source] }),
    writeRegistry: (registry) => registry,
  });
  const { server, origin } = await listen(app);
  t.after(() => server.close());

  const first = await (await fetch(`${origin}/api/sessions/revision`)).json();
  assert.equal(first.ok, true);
  assert.equal(typeof first.data.revision, 'string');
  const sessionsBody = await (await fetch(`${origin}/api/sessions`)).json();
  assert.equal(sessionsBody.ok, true);
  assert.equal(sessionsBody.data.revision, first.data.revision, '/api/sessions carries the same live revision as the poll endpoint');

  // A native create is reflected by a changed revision on the next poll.
  writeRollout(home, 'rollout-2026-09-07T11-00-00-b.jsonl');
  const second = await (await fetch(`${origin}/api/sessions/revision`)).json();
  assert.notEqual(second.data.revision, first.data.revision, 'a native create changes the polled revision');

  // archived_sessions writes are outside the projection and must not change the revision.
  writeRollout(home, 'rollout-2026-09-07T12-00-00-c.jsonl', { archived: true });
  const third = await (await fetch(`${origin}/api/sessions/revision`)).json();
  assert.equal(third.data.revision, second.data.revision, 'archived writes do not change the active revision');

  // An active-source switch (new enabled codex home) is reflected even with an identical tree.
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s2-rev-http-other-'));
  const otherSource = makeSource('codex-src-rev-2', otherHome);
  const switchedApp = createHandoffHttpAdapter({
    rootDir: otherHome,
    readRegistry: () => ({ version: 1, sources: [otherSource] }),
    writeRegistry: (registry) => registry,
  });
  const other = await listen(switchedApp);
  t.after(() => other.server.close());
  const switched = await (await fetch(`${other.origin}/api/sessions/revision`)).json();
  assert.notEqual(switched.data.revision, first.data.revision, 'a source switch changes the polled revision');
  // reset cwd-identity cache so any shared tmpdir across suite runs cannot interfere
  resetWorkspaceIdentityCache();
});
