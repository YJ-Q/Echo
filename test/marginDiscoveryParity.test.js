import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverSessions, resolveCodexHome } from '../src/core/handoff/session-source.js';

test('Codex discovery honors its supplied user profile instead of ambient process home', async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-profile-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const sessions = path.join(profile, '.codex', 'sessions', '2026', '09', '06');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'rollout-2026-09-06T12-00-00-abc.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { cwd: 'D:\\repo', thread_source: 'user' } })}\n`);
  assert.equal(resolveCodexHome(undefined, { env: { USERPROFILE: profile } }), path.join(profile, '.codex'));
  const found = await discoverSessions(undefined, { env: { USERPROFILE: profile } });
  assert.deepEqual(found.map((session) => session.id), ['abc']);
});
