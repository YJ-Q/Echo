import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../web/src/App.js';
import { createInitialWorkbenchState, errorLabel, statusGroup } from '../web/src/workbenchState.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://echo.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

test('workbench state exposes deterministic status groups and stable error labels without domain data', () => {
  assert.deepEqual(createInitialWorkbenchState(), {
    selectedId: null, tab: 'conversation', formInput: '', loading: true, error: null, message: null, cursor: 0
  });
  assert.equal(statusGroup('running'), 'active');
  assert.equal(statusGroup('needs_owner'), 'attention');
  assert.equal(statusGroup('completed'), 'complete');
  assert.equal(statusGroup('unrecognized'), 'unknown');
  assert.equal(errorLabel({ code: 'transport_unavailable' }), 'Connection unavailable. Try again.');
  assert.equal(errorLabel({ code: 'version_conflict' }), 'This view is out of date. Refresh and try again.');
});

test('App mounts three named regions, starts loading, and renders an empty workstream result', async () => {
  const dom = installDom();
  let resolveQuery;
  const api = { query(type) {
    if (type === 'needs_owner.list') return Promise.resolve({ ok: true, data: { items: [] }, meta: {} });
    return new Promise((resolve) => { resolveQuery = resolve; });
  } };
  const root = createRoot(document.getElementById('root'));

  await act(async () => { root.render(React.createElement(App, { api })); });
  assert.match(document.body.textContent, /Loading workstreams/);
  assert.deepEqual([...document.querySelectorAll('main > [aria-label]')].map((node) => node.getAttribute('aria-label')), [
    'Workstreams', 'Current Workstream', 'Control and Context'
  ]);

  await act(async () => { resolveQuery({ ok: true, data: { items: [] }, meta: { requestId: 'list-1' } }); });
  assert.match(document.body.textContent, /No workstreams yet/);
  assert.deepEqual([...document.querySelectorAll('[data-workstream-group]')].map((node) => node.getAttribute('data-workstream-group')), [
    'Running', 'Needs Owner', 'Waiting', 'Paused', 'Completed'
  ]);
  assert.equal(document.body.textContent.includes('list-1'), false);
  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('App keeps the Workstream summary fixed, switches three center tabs, and keeps controls and context on the right', async () => {
  const dom = installDom();
  const workstream = {
    id: 'ws-1', title: 'Frozen IA', goal: 'Keep authority visible', status: 'paused', priority: 1,
    currentState: 'Awaiting review', currentPlan: ['Review evidence', 'Resume safely'], nextAction: 'Choose approval',
    blockers: [], autonomyLevel: 1, workspaceReference: null, latestCheckpoint: null, activeRun: null,
    version: 4, updatedAt: '2026-08-24T00:00:00Z'
  };
  const needsOwner = {
    id: 'need-1', workstreamId: 'ws-1', runId: 'run-1', type: 'approval', reason: 'Owner approval required',
    options: [{ id: 'approve', label: 'Approve' }], consequenceSummary: 'Run remains paused',
    contextSummary: 'Evidence is ready', status: 'open', version: 1
  };
  const run = { id: 'run-1', workstreamId: 'ws-1', status: 'paused', version: 2 };
  const api = {
    async query(type, payload = {}) {
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [needsOwner], nextCursor: null }, meta: {} };
      if (type === 'run.list') return { ok: true, data: { items: [run], nextCursor: null }, meta: {} };
      if (type === 'artifact.list') return { ok: true, data: { items: [], nextCursor: null }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0 }, meta: {} };
      if (type === 'resume_brief.get') return { ok: true, data: { workstreamId: payload.workstreamId, generatedAt: '2026-09-01T00:00:00Z', facts: { goal: 'Keep authority visible', nextAction: null, currentPlan: [], blockers: [], currentState: null }, run: null, checkpoint: null, needsOwner: [], decisions: [], memories: [], recentActivity: [], recommendations: [], sourceVersions: [] }, meta: {} };
      if (type === 'memory.list') return { ok: true, data: { items: [] }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) {
      return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} };
    }
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App, { api })); });
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  try {
    const center = document.querySelector('[aria-label="Current Workstream"]');
    const right = document.querySelector('[aria-label="Control and Context"]');
    assert.match(center.textContent, /Frozen IA/);
    assert.match(center.textContent, /Keep authority visible/);
    assert.deepEqual([...center.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent), ['Conversation', 'Artifacts', 'Activity', 'Resume Brief', 'Memories']);
    assert.equal(center.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Conversation');
    assert.equal(center.querySelector('[data-conversation-panel]').closest('[role="tabpanel"]').hidden, false);
    assert.match(right.textContent, /Run controls/);
    assert.match(right.textContent, /paused/);
    assert.match(right.textContent, /Review evidence, Resume safely/);
    assert.match(right.textContent, /Choose approval/);
    assert.match(right.textContent, /Owner approval required/);

    await act(async () => { center.querySelector('[role="tab"][data-workbench-tab="artifacts"]').click(); });
    assert.equal(center.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Artifacts');
    assert.equal(center.querySelector('[data-artifact-panel]').closest('[role="tabpanel"]').hidden, false);
    assert.match(center.textContent, /Frozen IA/);

    await act(async () => { center.querySelector('[role="tab"][data-workbench-tab="activity"]').click(); });
    assert.equal(center.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Activity');
    assert.equal(center.querySelector('[data-activity-panel]').closest('[role="tabpanel"]').hidden, false);
    assert.match(center.textContent, /Keep authority visible/);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
  }
});

test('App renders a stable error and retries the shell query', async () => {
  const dom = installDom();
  let calls = 0;
  const api = {
    async query() {
      calls += 1;
      return calls === 1
        ? { ok: false, error: { code: 'transport_unavailable', retryable: true, message: 'private' }, meta: {} }
        : { ok: true, data: { items: [] }, meta: {} };
    }
  };
  const root = createRoot(document.getElementById('root'));

  await act(async () => { root.render(React.createElement(App, { api })); });
  assert.match(document.body.textContent, /Connection unavailable\. Try again\./);
  assert.equal(document.body.textContent.includes('private'), false);
  await act(async () => { document.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.equal(calls, 4);
  assert.match(document.body.textContent, /No workstreams yet/);
  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('web shell source does not persist or own domain DTOs', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../web/src/App.js', import.meta.url), 'utf8'));
  assert.equal(/(?:localStorage|sessionStorage|indexedDB)/.test(source), false);
  assert.equal(/\b(?:workstreams|artifacts)\s*=\s*(?:\{|Array|\[)/i.test(source), false);
  assert.equal(/conversation\s*[:=]\s*(?:\{|Array|\[)/i.test(source), false);
});

test('App does not write browser storage while loading the shell', async () => {
  const dom = installDom();
  const writes = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    const storage = window[name];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = storage[method].bind(storage);
      Object.defineProperty(storage, method, {
        configurable: true,
        value(...args) { writes.push([name, method, ...args]); return original(...args); }
      });
    }
  }
  const indexedDb = {
    open(...args) { writes.push(['indexedDB', 'open', ...args]); },
    deleteDatabase(...args) { writes.push(['indexedDB', 'deleteDatabase', ...args]); }
  };
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDb });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDb });
  const root = createRoot(document.getElementById('root'));

  await act(async () => { root.render(React.createElement(App, { api: { async query() { return { ok: true, data: { items: [] } }; } } })); });

  assert.deepEqual(writes, []);
  await act(async () => { root.unmount(); });
  dom.window.close();
});
