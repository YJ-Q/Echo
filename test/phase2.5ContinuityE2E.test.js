import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createWebWorkbench } from '../src/web/createWebWorkbench.js';
import { App } from '../web/src/App.js';
import { createApiClient } from '../web/src/apiClient.js';

function fakeRuntimeFactory() {
  return async () => ({
    async createSession() { return { id: `rt-${Date.now()}`, async send() { return { text: '', toolResults: [] }; }, async close() {} }; },
    async haltSession() { return { halted: true }; },
    async close() {}
  });
}

function installDom(origin) {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { url: `${origin}/`, pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

async function mountBrowser(origin) {
  const dom = installDom(origin);
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

async function eventually(read, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value;
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); value = read(); });
    if (value) return value;
  }
  assert.fail(message);
}

async function click(selector) {
  const el = await eventually(() => { const c = document.querySelector(selector); return c && !c.disabled ? c : null; }, `Missing or disabled: ${selector}`);
  await act(async () => { el.click(); });
  return el;
}

function requestFactory() {
  let seq = 0;
  return (prefix) => `${prefix}-${++seq}`;
}

test('A -> B -> A continuity loop through real Core, HTTP, and App', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-phase2.5-e2e-'));
  const dbPath = path.join(directory, 'margin-core.sqlite');
  const staticDir = path.join(directory, 'dist');
  const nextId = requestFactory();
  let workbench;
  let browser;
  let wsAId;
  let wsBId;
  let runAId;
  let runAVersion;

  const compose = () => createWebWorkbench({
    rootDir: directory, staticDir, dbPath, host: '127.0.0.1', port: 0,
    env: { YAPI_API_KEY: 'test' },
    dependencies: { createPiTerminalPilotRuntime: fakeRuntimeFactory() }
  });

  const cmd = async (api, type, payload, expectedVersion) => {
    const rid = nextId(type.replace('.', '-'));
    const result = await api.command(type, payload, { requestId: rid, idempotencyKey: `${rid}-k`, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
    assert.equal(result.ok, true, `${type}: ${JSON.stringify(result.error)}`);
    return result.data;
  };

  try {
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><main id="root"></main>', 'utf8');
    workbench = await compose();
    const { origin } = await workbench.start();
    browser = await mountBrowser(origin);
    const { api } = browser;

    // Create workstreams A and B
    const wsA = await cmd(api, 'workstream.create', { title: 'Workstream A', goal: 'Ship A', scenario: 'career_project' });
    wsAId = wsA.id;
    const wsB = await cmd(api, 'workstream.create', { title: 'Workstream B', goal: 'Ship B', scenario: 'learning_research' });
    wsBId = wsB.id;

    // Create and start Run A
    const runA = await cmd(api, 'run.create', { workstreamId: wsAId, workerKind: 'pi', scope: 'Work on A' });
    runAId = runA.id;
    const startedA = await cmd(api, 'run.start', { runId: runAId }, runA.version);
    runAVersion = startedA.version;

    // Switch from A to B — should pause A and return B brief
    const switchResult = await cmd(api, 'workstream.switch', { sourceWorkstreamId: wsAId, sourceRunId: runAId, targetWorkstreamId: wsBId }, runAVersion);
    assert.equal(switchResult.sourceRun.status, 'paused');
    assert.ok(switchResult.targetBrief);
    assert.equal(switchResult.targetBrief.workstreamId, wsBId);

    // B Resume Brief excludes A workstreamId
    const briefB = await api.query('resume_brief.get', { workstreamId: wsBId });
    assert.equal(briefB.ok, true);
    assert.equal(briefB.data.workstreamId, wsBId);

    // Verify A run is paused in DB via query
    const runAFinal = await api.query('run.get', { runId: runAId });
    assert.equal(runAFinal.ok, true);
    assert.equal(runAFinal.data.status, 'paused');

    // Restart: close workbench and reopen against same DB
    await closeBrowser(browser);
    browser = null;
    await workbench.close();
    workbench = null;

    workbench = await compose();
    const { origin: origin2 } = await workbench.start();
    browser = await mountBrowser(origin2);
    const api2 = browser.api;

    // A Resume Brief still accessible after restart
    const briefA = await api2.query('resume_brief.get', { workstreamId: wsAId });
    assert.equal(briefA.ok, true);
    assert.equal(briefA.data.workstreamId, wsAId);

    // Workstream list still has both A and B
    const list = await api2.query('workstream.list', {});
    assert.equal(list.ok, true);
    const ids = list.data.items.map((ws) => ws.id);
    assert.ok(ids.includes(wsAId));
    assert.ok(ids.includes(wsBId));

    // Events cursor is strictly increasing
    const events = await api2.events('event.list', { afterCursor: 0, limit: 100 });
    assert.equal(events.ok, true, `event.list: ${JSON.stringify(events.error)}`);
    const cursors = events.data.items.map((e) => e.cursor);
    for (let i = 1; i < cursors.length; i++) {
      assert.ok(cursors[i] > cursors[i - 1], `Cursor ${cursors[i]} not > ${cursors[i - 1]}`);
    }
  } finally {
    await closeBrowser(browser);
    if (workbench) await workbench.close().catch(() => null);
    await rm(directory, { recursive: true, force: true }).catch(() => null);
  }
});
