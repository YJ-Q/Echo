import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverSessions, resumableSessions } from '../src/core/handoff/session-source.js';
import { adapterFor } from '../src/agents/adapters.js';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';

function writeRollout(root, name, payload, { archived = false } = {}) {
  const dir = archived ? path.join(root, 'archived_sessions') : path.join(root, 'sessions', '2026', '09', '07');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload })}\n`);
  return file;
}

function appendRecord(file, timestamp, type, payload) {
  fs.appendFileSync(file, `${JSON.stringify({ timestamp, type, payload })}\n`);
}

async function listen(app) {
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('S1 canonical active discovery uses payload id, filters before limit, and removes archived/deleted records', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s1-truth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const older = writeRollout(root, 'rollout-2026-09-07T10-00-00-rollout-a.jsonl', { session_id: 'native-a', cwd: root, thread_source: 'user' });
  const newer = writeRollout(root, 'rollout-2026-09-07T11-00-00-rollout-b.jsonl', { session_id: 'native-a', cwd: root, thread_source: 'user' });
  appendRecord(older, '2026-09-07T10:00:00.000Z', 'event_msg', { type: 'task_complete' });
  appendRecord(newer, '2026-09-07T11:00:00.000Z', 'event_msg', { type: 'task_complete' });
  writeRollout(root, 'rollout-2026-09-07T12-00-00-internal.jsonl', { session_id: 'internal', cwd: root, thread_source: 'subagent' });
  writeRollout(root, 'rollout-2026-09-07T13-00-00-archived.jsonl', { session_id: 'archived-only', cwd: root, thread_source: 'user' }, { archived: true });
  writeRollout(root, 'rollout-2026-09-07T14-00-00-archived-copy.jsonl', { session_id: 'native-a', cwd: root, thread_source: 'user' }, { archived: true });

  const first = await discoverSessions(root, { sourceId: 'source-one', limit: 1 });
  assert.equal(first.length, 1, 'internal records cannot consume the limit');
  assert.equal(first[0].id, 'native-a', 'payload.session_id wins over rollout filename');
  assert.equal(first[0].nativeSessionId, 'native-a');
  assert.equal(first[0].rolloutId, 'rollout-b', 'newest active physical rollout is retained as provenance');
  assert.equal(first[0].canonicalId, 'codex:source-one:native-a');
  assert.equal(first.some((session) => session.id === 'archived-only'), false);

  fs.rmSync(newer);
  const afterOneRolloutDeleted = await discoverSessions(root, { sourceId: 'source-one' });
  assert.deepEqual(afterOneRolloutDeleted.map((session) => session.id), ['native-a']);
  fs.rmSync(older);
  const afterSuccessfulRefresh = await discoverSessions(root, { sourceId: 'source-one' });
  assert.deepEqual(afterSuccessfulRefresh, [], 'a successful snapshot replaces deleted native files');
});

test('S1 canonical identity does not merge equal native ids from different sources', () => {
  const source = path.join(os.tmpdir(), 'missing-session-source.jsonl');
  const sessions = resumableSessions([
    { id: 'same-native', nativeSessionId: 'same-native', sourceId: 'one', agentType: 'codex', threadSource: 'user', cwd: '', originalPath: source, updatedAt: new Date('2026-09-07T10:00:00Z') },
    { id: 'same-native', nativeSessionId: 'same-native', sourceId: 'two', agentType: 'codex', threadSource: 'user', cwd: '', originalPath: source, updatedAt: new Date('2026-09-07T10:00:00Z') },
  ]);
  assert.deepEqual(sessions.map((session) => session.canonicalId), ['codex:one:same-native', 'codex:two:same-native']);
});

test('S1 CLI adapter and Electron HTTP use the same canonical session projection', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s1-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeRollout(root, 'rollout-2026-09-07T10-00-00-physical.jsonl', { session_id: 'native-parity', cwd: root, thread_source: 'user' });
  const source = { id: 'codex-source-parity', type: 'codex', path: root, enabled: true, origin: 'manual' };
  const cliSessions = await adapterFor('codex').discoverSessions(source);
  const app = createHandoffHttpAdapter({ rootDir: root, readRegistry: () => ({ version: 1, sources: [source] }), writeRegistry: (registry) => registry });
  const { server, origin } = await listen(app);
  t.after(() => server.close());
  const response = await fetch(`${origin}/api/sessions`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.sessions.map((session) => session.id), cliSessions.map((session) => session.id));
  assert.equal(cliSessions[0].canonicalId, 'codex:codex-source-parity:native-parity');
});

test('S8.2.3 tracks execution lifecycle by complete-record cursor and becomes idle after terminal events', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s73-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rollout = writeRollout(root, 'rollout-2026-09-07T10-00-00-physical.jsonl', { session_id: 'native-resume', cwd: root, thread_source: 'user' });
  appendRecord(rollout, '2026-09-07T10:00:00.000Z', 'session_meta', { session_id: 'native-resume', cwd: root, thread_source: 'user' });
  appendRecord(rollout, '2026-09-07T10:02:00.000Z', 'event_msg', { type: 'task_complete', turn_id: 'first' });
  fs.utimesSync(rollout, new Date('2026-09-07T09:00:00Z'), new Date('2026-09-07T09:00:00Z'));
  let [session] = await discoverSessions(root, { sourceId: 's73' });
  assert.equal(session.updatedAt, '2026-09-07T10:02:00.000Z');
  assert.equal(session.executionStatus, 'unknown', 'historical unmatched lifecycle is neutral at runtime startup');

  appendRecord(rollout, '2026-09-07T11:00:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'resumed' });
  [session] = await discoverSessions(root, { sourceId: 's73' });
  assert.equal(session.updatedAt, '2026-09-07T11:00:00.000Z', 'a resumed turn advances from its record timestamp, never mtime');
  assert.equal(session.executionStatus, 'working');

  appendRecord(rollout, '2026-09-07T11:01:00.000Z', 'event_msg', { type: 'task_complete', turn_id: 'resumed' });
  [session] = await discoverSessions(root, { sourceId: 's73' });
  assert.equal(session.executionStatus, 'idle');
  appendRecord(rollout, '2026-09-07T11:02:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'aborted' });
  await discoverSessions(root, { sourceId: 's73' });
  appendRecord(rollout, '2026-09-07T11:03:00.000Z', 'event_msg', { type: 'turn_aborted', turn_id: 'aborted' });
  [session] = await discoverSessions(root, { sourceId: 's73' });
  assert.equal(session.executionStatus, 'idle');
});

test('S7.5 consumes a complete task_started before a trailing partial line and tracks a new rollout from birth', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s75-cursor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const existing = writeRollout(root, 'rollout-2026-09-07T10-00-00-existing.jsonl', { session_id: 'native-existing', cwd: root, thread_source: 'user' });
  appendRecord(existing, '2026-09-07T10:00:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'historical' });
  let [session] = await discoverSessions(root, { sourceId: 's75' });
  assert.equal(session.executionStatus, 'unknown', 'the cold baseline never restores historical green');

  appendRecord(existing, '2026-09-07T10:01:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'live' });
  fs.appendFileSync(existing, '{"timestamp":"2026-09-07T10:01:01.000Z"');
  [session] = await discoverSessions(root, { sourceId: 's75' });
  assert.equal(session.executionStatus, 'working', 'a later partial line cannot hide a preceding complete start');

  fs.appendFileSync(existing, ',"type":"event_msg","payload":{"type":"task_complete","turn_id":"live"}}\n');
  [session] = await discoverSessions(root, { sourceId: 's75' });
  assert.equal(session.executionStatus, 'idle', 'the completed partial record is consumed exactly once when it becomes complete');

  const bornLive = writeRollout(root, 'rollout-2026-09-07T11-00-00-new.jsonl', { session_id: 'native-new', cwd: root, thread_source: 'user' });
  appendRecord(bornLive, '2026-09-07T11:00:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'new-rollout' });
  const sessions = await discoverSessions(root, { sourceId: 's75' });
  assert.equal(sessions.find((item) => item.id === 'native-new')?.executionStatus, 'working', 'a rollout created after startup is live from byte zero');
});

test('S8.2.3 keeps idle sticky across ordinary reconciliations and unknown records', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s751-waiting-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rollout = writeRollout(root, 'rollout-2026-09-07T10-00-00-waiting.jsonl', { session_id: 'native-waiting', cwd: root, thread_source: 'user' });
  await discoverSessions(root, { sourceId: 's751' });
  appendRecord(rollout, '2026-09-07T10:00:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'one' });
  let [session] = await discoverSessions(root, { sourceId: 's751' });
  assert.equal(session.executionStatus, 'working');
  appendRecord(rollout, '2026-09-07T10:01:00.000Z', 'event_msg', { type: 'task_complete', turn_id: 'one' });
  [session] = await discoverSessions(root, { sourceId: 's751' });
  assert.equal(session.executionStatus, 'idle');

  appendRecord(rollout, '2026-09-07T10:02:00.000Z', 'event_msg', { type: 'token_count', total_token_usage: 42 });
  for (let refresh = 0; refresh < 5; refresh += 1) {
    [session] = await discoverSessions(root, { sourceId: 's751' });
    assert.equal(session.executionStatus, 'idle', `ordinary reconciliation ${refresh} must not reset idle`);
  }
  appendRecord(rollout, '2026-09-07T10:03:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'two' });
  [session] = await discoverSessions(root, { sourceId: 's751' });
  assert.equal(session.executionStatus, 'working', 'only a new explicit lifecycle event changes sticky idle');
});

test('S7.3 aggregates foreground physical rollouts and rejects internal and partial evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s73-group-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = writeRollout(root, 'rollout-2026-09-07T10-00-00-first.jsonl', { session_id: 'native-group', cwd: root, thread_source: 'user' });
  const second = writeRollout(root, 'rollout-2026-09-07T11-00-00-second.jsonl', { session_id: 'native-group', cwd: root, thread_source: 'user' });
  const internal = writeRollout(root, 'rollout-2026-09-07T12-00-00-internal.jsonl', { session_id: 'native-group', cwd: root, thread_source: 'guardian_review' });
  appendRecord(first, '2026-09-07T10:00:00.000Z', 'session_meta', { session_id: 'native-group', cwd: root, thread_source: 'user' });
  appendRecord(second, '2026-09-07T11:00:00.000Z', 'session_meta', { session_id: 'native-group', cwd: root, thread_source: 'user' });
  appendRecord(second, '2026-09-07T11:05:00.000Z', 'event_msg', { type: 'task_complete' });
  appendRecord(internal, '2026-09-07T12:00:00.000Z', 'session_meta', { session_id: 'native-group', cwd: root, thread_source: 'guardian_review' });
  appendRecord(internal, '2026-09-07T12:30:00.000Z', 'event_msg', { type: 'task_started' });
  let [session] = await discoverSessions(root, { sourceId: 's73-group' });
  assert.equal(session.createdAt, '2026-09-07T10:00:00.000Z');
  assert.equal(session.updatedAt, '2026-09-07T11:05:00.000Z');
  assert.equal(session.originalPath, second);
  assert.equal(session.executionStatus, 'unknown', 'internal lifecycle cannot make a foreground session green');

  fs.appendFileSync(second, '{"timestamp":"2026-09-07T12:00:00.000Z"');
  [session] = await discoverSessions(root, { sourceId: 's73-group' });
  assert.equal(session.updatedAt, '2026-09-07T11:05:00.000Z', 'a partial trailing record cannot refresh recency');
  assert.equal(session.executionStatus, 'unknown', 'partial JSONL produces no running inference');
});
