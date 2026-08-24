import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';

function fakeRuntimeFactory(evidence) {
  return async () => {
    let sequence = 0;
    const sessions = new Map();
    return {
      async createSession() {
        const id = `fake-runtime-${++sequence}`;
        const session = { id, async send() { return { text: '', toolResults: [] }; }, async close() { sessions.delete(id); evidence.push(['close', id]); } };
        sessions.set(id, session);
        evidence.push(['create', id]);
        return session;
      },
      async haltSession(id) { evidence.push(['halt', id]); sessions.delete(id); return { halted: true }; },
      async close() { evidence.push(['runtime-close']); sessions.clear(); }
    };
  };
}

function browser(origin) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: `${origin}/` });
  return {
    dom,
    fetch(route, options) { return fetch(new URL(route, dom.window.location.href), options); }
  };
}

function requestFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-${++sequence}`;
}

async function post(browserClient, route, body) {
  const response = await browserClient.fetch(route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const envelope = await response.json();
  assert.equal(envelope.ok, true, `${route}: ${JSON.stringify(envelope.error)}`);
  return envelope.data;
}

test('real Core and HTTP survive browser/server restart without a second state store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2b-e2e-'));
  const staticDir = path.join(directory, 'web', 'dist');
  const dbPath = path.join(directory, 'data', 'margin-core.sqlite');
  const runtimeEvidence = [];
  const nextId = requestFactory();
  let workbench;
  let firstBrowser;
  let secondBrowser;
  const composition = () => createWebWorkbench({
    rootDir: directory, staticDir, dbPath, host: '127.0.0.1', port: 0,
    env: { YAPI_API_KEY: 'present-for-e2e' },
    dependencies: { createPiTerminalPilotRuntime: fakeRuntimeFactory(runtimeEvidence) }
  });
  const command = (client, type, payload, expectedVersion) => {
    const requestId = nextId(type.replace('.', '-'));
    return post(client, '/api/commands', {
      type, requestId, idempotencyKey: `${requestId}-intent`,
      ...(expectedVersion === undefined ? {} : { expectedVersion }), payload
    });
  };
  const query = (client, type, payload) => post(client, '/api/queries', { type, requestId: nextId('query'), payload });
  const events = async (client, workstreamId, afterCursor = 0) => {
    const requestId = nextId('events');
    const payload = encodeURIComponent(JSON.stringify({ workstreamId, afterCursor, limit: 100 }));
    const response = await client.fetch(`/api/events?type=event.list&requestId=${requestId}&payload=${payload}`);
    const envelope = await response.json();
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    return envelope.data;
  };

  try {
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><main id="root"></main>', 'utf8');
    workbench = await composition();
    const firstStart = await workbench.start();
    firstBrowser = browser(firstStart.origin);

    const workstream = await command(firstBrowser, 'workstream.create', {
      title: 'Phase 2B restart', goal: 'Prove Web persistence', scenario: 'career_project', priority: 2,
      currentPlan: ['start', 'restart', 'finish'], nextAction: 'start the run'
    });
    let run = await command(firstBrowser, 'run.create', {
      workstreamId: workstream.id, workerKind: 'pi', scope: 'Exercise the Web restart path',
      stopCondition: 'acceptance complete', allowedActions: ['read', 'write'], forbiddenActions: ['external_write']
    });
    run = await command(firstBrowser, 'run.start', { runId: run.id }, run.version);
    run = await command(firstBrowser, 'run.pause', { runId: run.id }, run.version);
    assert.equal(run.status, 'paused');
    run = await command(firstBrowser, 'run.resume', { runId: run.id }, run.version);
    assert.equal(run.status, 'running');
    const runningVersion = run.version;
    const beforeRestartEvents = await events(firstBrowser, workstream.id);
    firstBrowser.dom.window.close();
    firstBrowser = null;
    await workbench.close();
    workbench = null;

    workbench = await composition();
    const secondStart = await workbench.start();
    secondBrowser = browser(secondStart.origin);
    const restoredWorkstream = await query(secondBrowser, 'workstream.get', { workstreamId: workstream.id });
    run = await query(secondBrowser, 'run.get', { runId: run.id });
    assert.equal(restoredWorkstream.id, workstream.id);
    assert.equal(run.status, 'paused');
    assert.equal(run.version, runningVersion + 1);
    assert.ok(run.checkpoint?.id);
    assert.equal(secondBrowser.dom.window.localStorage.length, 0);

    run = await command(secondBrowser, 'run.resume', { runId: run.id }, run.version);
    const artifact = await command(secondBrowser, 'artifact.create', {
      workstreamId: workstream.id, runId: run.id, type: 'report', title: 'Phase 2B evidence',
      resourceReference: { uri: 'margin://artifact/phase2b-evidence', contentHash: 'phase2b-e2e-hash' },
      metadata: { format: 'markdown' }, previewMetadata: { lineCount: 8 }
    });
    let needsOwner = await command(secondBrowser, 'needs_owner.create', {
      workstreamId: workstream.id, runId: run.id, type: 'approval', reason: 'Approve completion',
      options: [{ id: 'approve', label: 'Approve', consequenceSummary: 'Stop the run' }],
      consequenceSummary: 'The run remains open', contextSummary: 'Restart evidence is complete'
    });
    needsOwner = await command(secondBrowser, 'needs_owner.resolve', {
      needsOwnerId: needsOwner.id, optionId: 'approve', resolutionSummary: 'Approved after Web restart'
    }, needsOwner.version);
    run = await command(secondBrowser, 'run.stop', { runId: run.id }, run.version);

    const [artifacts, needsOwners, finalEvents, activity] = await Promise.all([
      query(secondBrowser, 'artifact.list', { workstreamId: workstream.id, runId: run.id, limit: 100 }),
      query(secondBrowser, 'needs_owner.list', { workstreamId: workstream.id, runId: run.id, limit: 100 }),
      events(secondBrowser, workstream.id),
      query(secondBrowser, 'activity.list', { workstreamId: workstream.id, afterCursor: 0, limit: 100 })
    ]);
    assert.equal(run.status, 'cancelled');
    assert.deepEqual(artifacts.items.map((item) => item.id), [artifact.id]);
    assert.equal(needsOwner.status, 'resolved');
    assert.deepEqual(needsOwners.items.map((item) => item.status), ['resolved']);
    const cursors = finalEvents.items.map((item) => item.cursor);
    assert.equal(cursors.every((cursor, index) => index === 0 || cursor > cursors[index - 1]), true);
    assert.equal(new Set(cursors).size, cursors.length);
    assert.ok(finalEvents.nextCursor > beforeRestartEvents.nextCursor);
    assert.deepEqual(activity.items.map((item) => item.cursor), cursors);
    assert.equal(activity.nextCursor, finalEvents.nextCursor);
    assert.ok(runtimeEvidence.some(([kind]) => kind === 'halt'));

    const files = await readdir(path.dirname(dbPath));
    assert.equal(files.filter((name) => name.includes('.sqlite')).every((name) => name.startsWith(path.basename(dbPath))), true);
    assert.equal(files.some((name) => name === 'echo.sqlite'), false);
  } finally {
    firstBrowser?.dom.window.close();
    secondBrowser?.dom.window.close();
    await workbench?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
