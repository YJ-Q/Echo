import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import test from 'node:test';
import { discoverSessions } from '../src/core/handoff/session-source.js';
import { readLatestCodexTurnStatus } from '../src/agents/codex/codexTurnStatus.js';

async function makeDb(t, turns) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-codex-terminal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'thread_history_1.sqlite');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('CREATE TABLE thread_turns (thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, rollout_ordinal INTEGER, status TEXT, error_json TEXT, started_at INTEGER, completed_at INTEGER)');
  for (const turn of turns) await db.run('INSERT INTO thread_turns VALUES (?, ?, ?, ?, ?, ?, ?)', turn);
  await db.close();
  return { root, dbPath };
}

function rollout(root, id = 'native') {
  const file = path.join(root, 'sessions', '2026', '09', '09', `rollout-2026-09-09T10-00-00-${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload: { session_id: id, cwd: root, thread_source: 'user' } })}\n`);
  return file;
}

function append(file, timestamp, payload) {
  fs.appendFileSync(file, `${JSON.stringify({ timestamp, type: 'event_msg', payload })}\n`);
}

test('native reader maps only latest failed terminal turn with structured error to error', async (t) => {
  const { root } = await makeDb(t, [['native', 'turn-1', 4, 'failed', '{"message":"boom"}', 100, 101]]);
  assert.equal((await readLatestCodexTurnStatus(root, 'native')).executionStatus, 'error');
});

test('native reader does not map missing structured error or interrupted terminal to error', async (t) => {
  const { root } = await makeDb(t, [['native', 'turn-1', 4, 'failed', null, 100, 101], ['other', 'turn-2', 5, 'interrupted', '{"message":"stop"}', 100, 101]]);
  assert.notEqual((await readLatestCodexTurnStatus(root, 'native')).executionStatus, 'error');
  assert.notEqual((await readLatestCodexTurnStatus(root, 'other')).executionStatus, 'error');
});

test('historical failure followed by newer success is not error', async (t) => {
  const { root } = await makeDb(t, [['native', 'turn-1', 4, 'failed', '{"message":"boom"}', 100, 101], ['native', 'turn-2', 5, 'completed', null, 102, 103]]);
  assert.equal((await readLatestCodexTurnStatus(root, 'native')).executionStatus, 'idle');
});

test('cold-start failure is red, then a newer live start and completion clear it', async (t) => {
  const db = await makeDb(t, [['native', 'turn-1', 4, 'failed', '{"message":"boom"}', 100, 101]]);
  const file = rollout(db.root);
  let [session] = await discoverSessions(db.root, { sourceId: 's' });
  assert.equal(session.executionStatus, 'error');
  append(file, '1970-01-01T00:02:00.000Z', { type: 'task_started', turn_id: 'turn-2' });
  [session] = await discoverSessions(db.root, { sourceId: 's' });
  assert.equal(session.executionStatus, 'working');
  append(file, '1970-01-01T00:03:00.000Z', { type: 'task_complete', turn_id: 'turn-2' });
  [session] = await discoverSessions(db.root, { sourceId: 's' });
  assert.equal(session.executionStatus, 'idle');
});

test('missing native database leaves normal JSONL lifecycle status unaffected', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-codex-no-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = rollout(root);
  await discoverSessions(root, { sourceId: 's' });
  append(file, '2026-09-09T10:01:00.000Z', { type: 'task_started' });
  const [session] = await discoverSessions(root, { sourceId: 's' });
  assert.equal(session.executionStatus, 'working');
});

test('live lifecycle remains isolated across Codex workspaces', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-codex-workspaces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = rollout(root, 'workspace-a');
  const b = rollout(root, 'workspace-b');
  // The fixture rollouts use distinct native identities; the same source/home
  // is intentionally shared to exercise the cross-workspace projection.
  await discoverSessions(root, { sourceId: 's' });
  append(a, '2026-09-09T10:01:00.000Z', { type: 'task_started', turn_id: 'a-1' });
  append(b, '2026-09-09T10:01:01.000Z', { type: 'task_started', turn_id: 'b-1' });
  let sessions = await discoverSessions(root, { sourceId: 's' });
  assert.deepEqual(new Map(sessions.map((item) => [item.id, item.executionStatus])), new Map([['workspace-a', 'working'], ['workspace-b', 'working']]));
  append(a, '2026-09-09T10:02:00.000Z', { type: 'task_complete', turn_id: 'a-1' });
  sessions = await discoverSessions(root, { sourceId: 's' });
  assert.equal(sessions.find((item) => item.id === 'workspace-a').executionStatus, 'idle');
  assert.equal(sessions.find((item) => item.id === 'workspace-b').executionStatus, 'working');
});
