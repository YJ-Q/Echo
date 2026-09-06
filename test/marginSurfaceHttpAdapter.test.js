import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';
import { resumableSessions } from '../src/core/handoff/session-source.js';

async function withServer(app, action) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function withRepo(action) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'margin-surface-repo-'));
  try { return await action(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('GET /api/resources/status is independent, read-only, and fail-soft', async () => {
  const app = createHandoffHttpAdapter({
    rootDir: os.tmpdir(),
    getAgentResourceStatus: () => ({ agents: [{ agent: 'codex', resources: [{ windowDurationMinutes: 300, percentUsed: 59, resetsAt: 1 }] }, { agent: 'claude-code', unavailable: true }] })
  });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/resources/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { agents: [{ agent: 'codex', resources: [{ windowDurationMinutes: 300, percentUsed: 59, resetsAt: 1 }] }, { agent: 'claude-code', unavailable: true }] });
  });
  const failed = createHandoffHttpAdapter({ rootDir: os.tmpdir(), getAgentResourceStatus: () => { throw new Error('source failed'); } });
  await withServer(failed, async (origin) => {
    const body = await (await fetch(`${origin}/api/resources/status`)).json();
    assert.equal(body.agents[0].unavailable, true);
    assert.equal(body.agents[1].agent, 'claude-code');
  });
});

test('GET /api/sessions returns only fields the discovery layer actually provided', async () => {
  const sessions = [{
    id: 's1', cwd: 'D:\\repo', branch: 'main', gitSha: 'abc', summary: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', originalPath: 'x.jsonl'
  }];
  const app = createHandoffHttpAdapter({ rootDir: os.tmpdir(), discoverSessions: async () => sessions });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/sessions`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.sessions, [{
      id: 's1', agent: 'Codex', cwd: 'D:\\repo', workspaceKey: null, workspaceName: null,
      branch: 'main', summary: null, label: null, updatedAt: '2026-01-02T00:00:00.000Z'
    }]);
  });
});

test('GET /api/sessions clamps and forwards the limit parameter', async () => {
  let receivedLimit;
  const app = createHandoffHttpAdapter({
    rootDir: os.tmpdir(),
    discoverSessions: async (_home, { limit } = {}) => { receivedLimit = limit; return []; }
  });
  await withServer(app, async (origin) => {
    await fetch(`${origin}/api/sessions?limit=500`);
  });
  assert.equal(receivedLimit, 20);
});

test('Slice 3.3: Workspace Overview uses the full resumable discovery result, not the global list cap', async () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    id: `s${index}`, workspaceKey: 'git:repo', workspaceName: 'repo', cwd: 'D:\\repo',
    updatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  let overviewSessions;
  const app = createHandoffHttpAdapter({
    rootDir: os.tmpdir(), discoverSessions: async (_home, options) => options?.limit ? sessions.slice(0, options.limit) : sessions,
    createWorkspaceOverview: ({ sessions: input }) => { overviewSessions = input; return { workspaceKey: 'git:repo', workspaceName: 'repo', otherResumableSessionCount: 11,
      latestSession: { id: 's11', label: 'Latest', updatedAt: null, historicalBranch: null, goal: { status: 'unknown', text: 'Unknown' }, progress: { text: 'Unknown' }, currentApplicability: { status: 'unknown', text: 'Unknown' } },
      repo: { observedAt: 'now', stableDuringObservation: true, branch: 'main', shortHead: 'abc', dirtyCount: 0 } }; }
  });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/workspace-overview?workspaceKey=git%3Arepo`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.latestSession.id, 's11');
  });
  assert.equal(overviewSessions.length, 12);
});

test('Slice 3.3: workspace session navigation returns all and only that workspace', async () => {
  const sessions = [
    { id: 'other', workspaceKey: 'git:other', workspaceName: 'other' },
    { id: 'old', workspaceKey: 'git:repo', workspaceName: 'repo' },
    { id: 'latest', workspaceKey: 'git:repo', workspaceName: 'repo' },
  ];
  const app = createHandoffHttpAdapter({ rootDir: os.tmpdir(), discoverSessions: async () => sessions });
  await withServer(app, async (origin) => {
    const body = await (await fetch(`${origin}/api/sessions?workspaceKey=git%3Arepo`)).json();
    assert.deepEqual(body.data.sessions.map((session) => session.id), ['old', 'latest']);
  });
});

test('POST /api/handoff/generate calls the real Core pipeline and returns only browser-safe checkpoint fields', async () => {
  await withRepo(async (repo) => {
    const meta = { id: 'abc', cwd: repo, originalPath: 'orig.jsonl' };
    let capturedRepo, capturedSessionMeta;
    const app = createHandoffHttpAdapter({
      rootDir: os.tmpdir(),
      discoverSessions: async () => [meta],
      captureSession: (sessionMeta) => { capturedSessionMeta = sessionMeta; return { snapshotPath: 'x', sha256: 'x' }; },
      generateHandoff: (_capture, workspace) => { capturedRepo = workspace; return {
        markdown: '# Margin Smart Handoff\n\nreal core output',
        resumeSummary: { goal: { text: 'Historical goal', confidence: 'Inferred' }, progress: [], currentApplicability: { status: 'unknown', text: 'Check first' }, currentValidation: { status: 'unknown', text: 'Validation not rerun' } },
        evidence: { raw: 'must not leak' }, truth: { sourcePath: 'must not leak' }, state: { operations: ['must not leak'] }
      }; }
    });
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/api/handoff/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'abc' })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.markdown, '# Margin Smart Handoff\n\nreal core output');
      assert.equal(body.data.session.id, 'abc');
      assert.equal(body.data.resumeSummary.goal.text, 'Historical goal');
      assert.deepEqual(Object.keys(body.data).sort(), ['markdown', 'resumeSummary', 'session']);
      assert.doesNotMatch(JSON.stringify(body.data), /must not leak/);
    });
    assert.equal(capturedRepo, repo);
    assert.equal(capturedSessionMeta.id, 'abc');
  });
});

test('POST /api/handoff/generate returns not_found for an unknown session id', async () => {
  const app = createHandoffHttpAdapter({ rootDir: os.tmpdir(), discoverSessions: async () => [] });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/handoff/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'missing' })
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'not_found');
  });
});

test('POST /api/handoff/save writes .margin/HANDOFF.md under the repo, creating the directory if needed', async () => {
  await withRepo(async (repo) => {
    const app = createHandoffHttpAdapter({ rootDir: os.tmpdir() });
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/api/handoff/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, markdown: '# Checkpoint one' })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.path, path.join(repo, '.margin', 'HANDOFF.md'));
    });
    const written = await readFile(path.join(repo, '.margin', 'HANDOFF.md'), 'utf8');
    assert.equal(written, '# Checkpoint one');
  });
});

test('POST /api/handoff/save overwrites an existing checkpoint with the new one (no history kept)', async () => {
  await withRepo(async (repo) => {
    const app = createHandoffHttpAdapter({ rootDir: os.tmpdir() });
    await withServer(app, async (origin) => {
      await fetch(`${origin}/api/handoff/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, markdown: '# First checkpoint' })
      });
      await fetch(`${origin}/api/handoff/save`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, markdown: '# Second checkpoint' })
      });
    });
    const written = await readFile(path.join(repo, '.margin', 'HANDOFF.md'), 'utf8');
    assert.equal(written, '# Second checkpoint');
  });
});

test('POST /api/handoff/save rejects a repo path that is not a real directory', async () => {
  const app = createHandoffHttpAdapter({ rootDir: os.tmpdir() });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/handoff/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: path.join(os.tmpdir(), 'does-not-exist-xyz'), markdown: '# x' })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_repo');
  });
});

test('Slice 2.3: GET /api/sessions serves the already-filtered resumable list — an internal Codex thread never reaches the UI DTO', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'margin-resumable-http-'));
  try {
    // Real native rollout shapes: one explicit guardian_review thread, one normal user thread.
    const meta = (id, source, threadSource) => JSON.stringify({ timestamp: '2026-09-05T10:10:08.267Z', type: 'session_meta',
      payload: { session_id: id, id, cwd: 'D:\\Code\\margin', originator: 'Codex Desktop', cli_version: '0.153.4',
        source, ...(threadSource ? { thread_source: threadSource } : {}) } }) + '\n';
    const internal = path.join(dir, 'rollout-guardian.jsonl');
    const normal = path.join(dir, 'rollout-user.jsonl');
    await writeFile(internal, meta('g1', { subagent: { other: 'guardian' } }, 'guardian_review'));
    await writeFile(normal, meta('u1', 'vscode', 'user'));

    // The Core boundary (resumableSessions — what discoverSessions() applies to continues'
    // output) has already dropped g1 before this list reaches the adapter.
    const discovered = [
      { id: 'g1', cwd: 'D:\\Code\\margin', branch: 'main', createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-05T11:00:00.000Z'), originalPath: internal },
      { id: 'u1', cwd: 'D:\\Code\\margin', branch: 'main', createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-09-05T12:00:00.000Z'), originalPath: normal },
    ];
    const app = createHandoffHttpAdapter({
      rootDir: os.tmpdir(),
      discoverSessions: async () => resumableSessions(discovered),
    });
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/api/sessions`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.deepEqual(body.data.sessions.map((s) => s.id), ['u1']);
      // The adapter does not re-filter and never leaks the internal thread or its metadata.
      const raw = JSON.stringify(body.data);
      assert.ok(!raw.includes('g1'));
      assert.ok(!raw.includes('threadSource') && !raw.includes('thread_source'));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
