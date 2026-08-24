import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';
import { App } from '../web/src/App.js';
import { createApiClient } from '../web/src/apiClient.js';

function fakeRuntimeFactory(evidence) {
  return async () => {
    let sequence = 0;
    const sessions = new Map();
    return {
      async createSession() {
        const id = `fake-runtime-${++sequence}`;
        const session = {
          id,
          async send() { return { text: '', toolResults: [] }; },
          async close() { sessions.delete(id); evidence.push(['close', id]); }
        };
        sessions.set(id, session);
        evidence.push(['create', id]);
        return session;
      },
      async haltSession(id) { evidence.push(['halt', id]); sessions.delete(id); return { halted: true }; },
      async close() { evidence.push(['runtime-close']); sessions.clear(); }
    };
  };
}

async function mountBrowser(origin) {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
    url: `${origin}/`, pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  const api = createApiClient({ baseUrl: origin, fetchImpl: fetch });
  await act(async () => { root.render(React.createElement(App, { api })); });
  return { dom, root, api };
}

async function closeBrowser(browser) {
  if (!browser) return;
  await act(async () => { browser.root.unmount(); });
  browser.dom.window.close();
}

async function eventually(read, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      value = read();
    });
    if (value) return value;
  }
  assert.fail(message);
}

async function observe(action) {
  let result;
  await act(async () => { result = await action(); });
  return result;
}

async function fill(element, value, eventName = 'input') {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new window.Event(eventName, { bubbles: true }));
  });
}

async function click(selector) {
  const element = await eventually(() => {
    const candidate = document.querySelector(selector);
    return candidate && candidate.disabled !== true ? candidate : null;
  }, `Missing or disabled DOM control: ${selector}`);
  await act(async () => { element.click(); });
  return element;
}

function requestFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-${++sequence}`;
}

test('real mounted App drives the Core workflow and restores authority after browser/server restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2b-e2e-'));
  const staticDir = path.join(directory, 'web', 'dist');
  const dbPath = path.join(directory, 'data', 'margin-core.sqlite');
  const runtimeEvidence = [];
  const nextId = requestFactory();
  let workbench;
  let firstBrowser;
  let secondBrowser;
  let workstreamId;
  let runId;
  const composition = () => createWebWorkbench({
    rootDir: directory, staticDir, dbPath, host: '127.0.0.1', port: 0,
    env: { YAPI_API_KEY: 'present-for-e2e' },
    dependencies: { createPiTerminalPilotRuntime: fakeRuntimeFactory(runtimeEvidence) }
  });
  const directCommand = async (api, type, payload, expectedVersion) => {
    const requestId = nextId(type.replace('.', '-'));
    const result = await api.command(type, payload, {
      requestId, idempotencyKey: `${requestId}-intent`,
      ...(expectedVersion === undefined ? {} : { expectedVersion })
    });
    assert.equal(result.ok, true, `${type}: ${JSON.stringify(result.error)}`);
    return result.data;
  };

  try {
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><main id="root"></main>', 'utf8');
    workbench = await composition();
    const firstStart = await workbench.start();
    firstBrowser = await mountBrowser(firstStart.origin);

    const form = await eventually(() => document.querySelector('[data-create-workstream]'), 'Create form did not mount');
    const [title, goal] = form.querySelectorAll('input');
    await fill(title, 'Phase 2B restart');
    await fill(goal, 'Prove mounted Web persistence');
    await click('[data-create-workstream] button[type="submit"]');
    const selectedRow = await eventually(
      () => document.querySelector('[data-workstream-id][aria-current="true"]'),
      'Created Workstream was not selected through the UI'
    );
    workstreamId = selectedRow.getAttribute('data-workstream-id');
    await eventually(() => document.querySelector('[aria-label="Current Workstream"], [aria-label="Workbench"]')?.textContent.includes('Phase 2B restart'), 'Workstream summary did not load');

    await click('[data-run-action="Create run"]');
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'queued', 'Run was not created through the UI');
    runId = (await observe(() => firstBrowser.api.query('run.list', { workstreamId, statuses: ['queued'], limit: 100 }))).data.items[0].id;
    await click('[data-run-action="Start"]');
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'running', 'Run did not start through the UI');
    await click('[data-run-action="Pause"]');
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'paused', 'Run did not pause through the UI');
    await click('[data-run-action="Resume"]');
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'running', 'Run did not resume through the UI');
    await click('[data-workbench-tab="activity"]');
    await eventually(() => document.querySelector('[role="tab"][data-workbench-tab="activity"]')?.getAttribute('aria-selected') === 'true', 'Activity tab did not activate');
    await eventually(() => document.querySelector('[data-activity-panel] .activity-item'), 'Activity did not render through the real App');
    const beforeRestartEvents = await observe(() => firstBrowser.api.events('event.list', { workstreamId, afterCursor: 0, limit: 100 }));

    await closeBrowser(firstBrowser);
    firstBrowser = null;
    await workbench.close();
    workbench = null;

    workbench = await composition();
    const secondStart = await workbench.start();
    const setupApi = createApiClient({ baseUrl: secondStart.origin, fetchImpl: fetch });
    const restoredWorkstream = await setupApi.query('workstream.get', { workstreamId });
    let restoredRun = await setupApi.query('run.get', { runId });
    assert.equal(restoredWorkstream.ok, true);
    assert.equal(restoredRun.data.status, 'paused');
    assert.ok(restoredRun.data.checkpoint?.id);

    const artifact = await directCommand(setupApi, 'artifact.create', {
      workstreamId, runId, type: 'report', title: 'Phase 2B evidence',
      resourceReference: { uri: 'margin://artifact/phase2b-evidence', contentHash: 'phase2b-e2e-hash' },
      metadata: { format: 'markdown' }, previewMetadata: { lineCount: 8 }
    });
    const needsOwner = await directCommand(setupApi, 'needs_owner.create', {
      workstreamId, runId, type: 'approval', reason: 'Approve completion',
      options: [{ id: 'approve', label: 'Approve', consequenceSummary: 'Stop the run' }],
      consequenceSummary: 'The run remains open', contextSummary: 'Restart evidence is complete'
    });

    secondBrowser = await mountBrowser(secondStart.origin);
    await click(`[data-workstream-id="${workstreamId}"]`);
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'paused', 'Reopened App did not load the reconciled Run');
    assert.match(document.querySelector('[aria-label="Control and Context"]').textContent, /Approve completion/);

    await click('[data-workbench-tab="artifacts"]');
    await eventually(() => document.querySelector('[data-artifact-panel]')?.textContent.includes('Phase 2B evidence'), 'Artifact panel did not load persisted metadata');
    await click('[data-workbench-tab="activity"]');
    await eventually(() => document.querySelector('[data-activity-panel] .activity-item'), 'Activity panel did not reopen persisted history');

    const option = await eventually(() => document.querySelector(`[data-needs-owner-option="${needsOwner.id}"]`), 'NeedsOwner option did not load');
    await fill(option, 'approve', 'change');
    await click(`[data-needs-owner-resolve="${needsOwner.id}"]`);
    await eventually(() => document.querySelector('[data-needs-owner-panel]')?.textContent.includes('No owner requests.'), 'NeedsOwner did not resolve through the UI');
    await click('[data-run-action="Resume"]');
    await eventually(() => document.querySelector('[data-run-status]')?.textContent === 'running', 'Reopened Run did not resume through the UI');
    await click('[data-run-action="Stop"]');
    await eventually(() => document.querySelector('[data-run-action="Create run"]'), 'Stopped Run did not reload authoritative controls');

    restoredRun = await observe(() => secondBrowser.api.query('run.get', { runId }));
    const [artifacts, needsOwners, finalEvents, activity] = await observe(() => Promise.all([
      secondBrowser.api.query('artifact.list', { workstreamId, runId, limit: 100 }),
      secondBrowser.api.query('needs_owner.list', { workstreamId, runId, limit: 100 }),
      secondBrowser.api.events('event.list', { workstreamId, afterCursor: 0, limit: 100 }),
      secondBrowser.api.query('activity.list', { workstreamId, afterCursor: 0, limit: 100 })
    ]));
    assert.equal(restoredRun.data.status, 'cancelled');
    assert.deepEqual(artifacts.data.items.map((item) => item.id), [artifact.id]);
    assert.deepEqual(needsOwners.data.items.map((item) => item.status), ['resolved']);
    const cursors = finalEvents.data.items.map((item) => item.cursor);
    assert.equal(cursors.every((cursor, index) => index === 0 || cursor > cursors[index - 1]), true);
    assert.equal(new Set(cursors).size, cursors.length);
    assert.ok(finalEvents.data.nextCursor > beforeRestartEvents.data.nextCursor);
    assert.deepEqual(activity.data.items.map((item) => item.cursor), cursors);
    assert.equal(activity.data.nextCursor, finalEvents.data.nextCursor);
    assert.ok(runtimeEvidence.some(([kind]) => kind === 'halt'));
    assert.equal(secondBrowser.dom.window.localStorage.length, 0);

    const files = await readdir(path.dirname(dbPath));
    assert.equal(files.filter((name) => name.includes('.sqlite')).every((name) => name.startsWith(path.basename(dbPath))), true);
    assert.equal(files.some((name) => name === 'echo.sqlite'), false);
  } finally {
    await closeBrowser(firstBrowser).catch(() => {});
    await closeBrowser(secondBrowser).catch(() => {});
    await workbench?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
