import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../web/src/App.js';
import { ActivityPanel } from '../web/src/components/ActivityPanel.js';
import { useWorkbenchData } from '../web/src/useWorkbenchData.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://echo.test/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function workstream() {
  return {
    id: 'ws-1', title: 'Workbench', goal: 'Ship controls', status: 'running', priority: 2,
    currentState: 'Active', currentPlan: [], nextAction: 'Control run', blockers: [], autonomyLevel: 1,
    workspaceReference: null, latestCheckpoint: null, activeRun: null, version: 9, updatedAt: '2026-08-24T00:00:00Z'
  };
}

function run(status = 'queued', version = 4) {
  return {
    id: 'run-1', workstreamId: 'ws-1', workerKind: 'pi', runtimeReference: null,
    scope: 'Web Workbench interactive run', status, currentStep: null, progress: null,
    limits: { stopCondition: null, allowedActions: [], forbiddenActions: [], budget: null },
    result: null, validationSummary: null, error: null, checkpoint: null, version,
    createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z', startedAt: null, endedAt: null
  };
}

function deferred() {
  let resolve;
  return { promise: new Promise((next) => { resolve = next; }), resolve };
}

async function mount(element) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(element); });
  return { dom, root };
}

async function unmount(view) {
  await act(async () => { view.root.unmount(); });
  view.dom.window.close();
}

function apiFixture({ status = 'queued', conflict = false } = {}) {
  const calls = [];
  const currentRun = run(status);
  const api = {
    async query(type, payload = {}) {
      calls.push({ kind: 'query', type, payload });
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream()] }, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream(), meta: {} };
      if (type === 'run.list') return { ok: true, data: { items: [currentRun], nextCursor: null }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0, hasMore: false }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(type, payload = {}) {
      calls.push({ kind: 'events', type, payload });
      return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0, hasMore: false }, meta: {} };
    },
    async command(type, payload, options) {
      calls.push({ kind: 'command', type, payload, options });
      if (conflict) return { ok: false, error: { code: 'version_conflict', retryable: false }, meta: {} };
      return { ok: true, data: currentRun, meta: {} };
    }
  };
  return { api, calls };
}

test('run controls expose only transitions allowed by the current Run DTO and send its version', async () => {
  const f = apiFixture();
  const view = await mount(React.createElement(App, { api: f.api }));
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });

  assert.equal(document.querySelector('[data-run-action="Start"]').disabled, false);
  assert.equal(document.querySelector('[data-run-action="Pause"]'), null);
  await act(async () => { document.querySelector('[data-run-action="Start"]').click(); });

  const command = f.calls.find((call) => call.kind === 'command');
  assert.deepEqual(command.payload, { runId: 'run-1' });
  assert.equal(command.type, 'run.start');
  assert.equal(command.options.expectedVersion, 4);
  assert.match(command.options.requestId, /^web_run_start_/);
  assert.match(command.options.idempotencyKey, /^web_run_start_intent_/);
  assert.ok(f.calls.filter((call) => call.type === 'run.list').length >= 2);
  assert.ok(f.calls.filter((call) => call.type === 'workstream.get').length >= 2);
  assert.ok(f.calls.filter((call) => call.type === 'workstream.list').length >= 2);
  await unmount(view);
});

test('a Run version conflict keeps the stable error and reloads authority instead of mutating the DTO', async () => {
  const f = apiFixture({ conflict: true });
  const view = await mount(React.createElement(App, { api: f.api }));
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  await act(async () => { document.querySelector('[data-run-action="Start"]').click(); });

  assert.match(document.querySelector('[data-run-controls]').textContent, /This view is out of date\. Refresh and try again\./);
  assert.equal(document.querySelector('[data-run-status]').textContent, 'queued');
  assert.ok(f.calls.filter((call) => call.type === 'run.list').length >= 2);
  assert.ok(f.calls.filter((call) => call.type === 'workstream.get').length >= 2);
  await unmount(view);
});

test('activity polling pauses while hidden, resumes from its processed cursor, and renders only Activity fields', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let timerId = 0;
  globalThis.setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  const dom = installDom();
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const calls = [];
  const api = {
    async events(type, payload) {
      calls.push({ kind: 'events', type, payload });
      if (calls.filter((call) => call.kind === 'events').length === 1) {
        return { ok: true, data: { items: [{ cursor: 1, eventId: 'raw-id', private: 'never render' }], nextCursor: 1, hasMore: false }, meta: {} };
      }
      return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} };
    },
    async query(type, payload) {
      calls.push({ kind: 'query', type, payload });
      return { ok: true, data: { items: [{ cursor: 1, title: 'Run started', summary: 'Safe summary', occurredAt: '2026-08-24T00:00:00Z', private: 'never render' }], nextCursor: 1, hasMore: false }, meta: {} };
    }
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(ActivityPanel, { api, workstreamId: 'ws-1' })); });
  assert.match(document.body.textContent, /Run started/);
  assert.equal(document.body.textContent.includes('never render'), false);
  assert.equal([...timers.values()].some((timer) => timer.delay === 3000), true);

  hidden = true;
  document.dispatchEvent(new window.Event('visibilitychange'));
  await act(async () => { for (const timer of [...timers.values()]) await timer.fn(); });
  assert.equal(calls.filter((call) => call.kind === 'events').length, 1);

  hidden = false;
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  assert.deepEqual(calls.filter((call) => call.kind === 'events').at(-1).payload, { workstreamId: 'ws-1', afterCursor: 1, limit: 100 });
  await act(async () => { root.unmount(); });
  dom.window.close();
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

test('changing the selected workstream discards prior activity and starts a separate cursor', async () => {
  const eventCalls = [];
  const api = {
    async events(_type, payload) {
      eventCalls.push(payload);
      const cursor = payload.workstreamId === 'ws-1' ? 1 : 2;
      return { ok: true, data: { items: [{ cursor }], nextCursor: cursor, hasMore: false }, meta: {} };
    },
    async query(_type, payload) {
      const isFirst = payload.workstreamId === 'ws-1';
      return {
        ok: true,
        data: {
          items: [{ cursor: isFirst ? 1 : 2, title: isFirst ? 'First activity' : 'Second activity', summary: 'Safe', occurredAt: '2026-08-24T00:00:00Z' }],
          nextCursor: isFirst ? 1 : 2, hasMore: false
        },
        meta: {}
      };
    }
  };
  const view = await mount(React.createElement(ActivityPanel, { api, workstreamId: 'ws-1' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.match(document.body.textContent, /First activity/);
  await act(async () => { view.root.render(React.createElement(ActivityPanel, { api, workstreamId: 'ws-2' })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.match(document.body.textContent, /Second activity/);
  assert.equal(document.body.textContent.includes('First activity'), false);
  assert.deepEqual(eventCalls.at(-1), { workstreamId: 'ws-2', afterCursor: 0, limit: 100 });
  await unmount(view);
});

test('a pending Run command cannot reload or write an older workstream after selection changes', async () => {
  const pending = deferred();
  const calls = [];
  const ws2 = { ...workstream(), id: 'ws-2', title: 'Second', activeRun: null };
  const api = {
    async query(type, payload = {}) {
      calls.push({ kind: 'query', type, payload });
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream(), ws2] }, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: payload.workstreamId === 'ws-2' ? ws2 : workstream(), meta: {} };
      if (type === 'run.list') return { ok: true, data: { items: [run(payload.workstreamId === 'ws-2' ? 'paused' : 'queued')], nextCursor: null }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) { return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} }; },
    command(type, payload, options) { calls.push({ kind: 'command', type, payload, options }); return pending.promise; }
  };
  const view = await mount(React.createElement(App, { api }));
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  await act(async () => { document.querySelector('[data-run-action="Start"]').click(); });
  await act(async () => { document.querySelector('[data-workstream-id="ws-2"]').click(); });
  assert.equal(document.querySelector('[data-workstream-id="ws-2"]').getAttribute('aria-current'), 'true');
  const callsBeforeResolution = calls.length;
  await act(async () => { pending.resolve({ ok: true, data: run('running'), meta: {} }); await Promise.resolve(); });
  assert.equal(document.querySelector('[data-workstream-id="ws-2"]').getAttribute('aria-current'), 'true');
  assert.equal(calls.slice(callsBeforeResolution).some((call) => call.payload?.workstreamId === 'ws-1'), false);
  await unmount(view);
});

test('a pending Event request from an older selection does not block immediate polling for the new workstream', async () => {
  const first = deferred();
  const eventCalls = [];
  const api = {
    events(_type, payload) {
      eventCalls.push(payload);
      if (payload.workstreamId === 'ws-1') return first.promise;
      return Promise.resolve({ ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} });
    },
    async query() { throw new Error('activity should not be queried for an empty Event page'); }
  };
  const view = await mount(React.createElement(ActivityPanel, { api, workstreamId: 'ws-1' }));
  await act(async () => { view.root.render(React.createElement(ActivityPanel, { api, workstreamId: 'ws-2' })); await Promise.resolve(); await Promise.resolve(); });
  assert.deepEqual(eventCalls.at(-1), { workstreamId: 'ws-2', afterCursor: 0, limit: 100 });
  await act(async () => { first.resolve({ ok: true, data: { items: [], nextCursor: 0, hasMore: false }, meta: {} }); await Promise.resolve(); });
  await unmount(view);
});

test('Run controls query the contract-open statuses instead of treating a terminal first page as the current Run', async () => {
  const calls = [];
  const terminalPage = Array.from({ length: 51 }, (_, index) => run('completed', index + 1));
  const api = {
    async query(type, payload = {}) {
      calls.push({ type, payload });
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream()] }, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream(), meta: {} };
      if (type === 'run.list') {
        return { ok: true, data: payload.statuses ? { items: [run('queued')], nextCursor: null } : { items: terminalPage, nextCursor: 'later' }, meta: {} };
      }
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) { return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} }; }
  };
  const view = await mount(React.createElement(App, { api }));
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  assert.equal(document.querySelector('[data-run-status]').textContent, 'queued');
  assert.deepEqual(calls.find((call) => call.type === 'run.list').payload, {
    workstreamId: 'ws-1', statuses: ['queued', 'running', 'paused', 'needs_owner'], limit: 100
  });
  await unmount(view);
});

test('an old Event generation cannot clear a new selection timer after the new poll has scheduled', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  let sequence = 0;
  globalThis.setTimeout = (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  const first = deferred();
  const calls = [];
  const dom = installDom();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  const api = {
    events(_type, payload) {
      calls.push(payload);
      if (payload.workstreamId === 'ws-1') return first.promise;
      return Promise.resolve({ ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} });
    },
    async query() { throw new Error('empty event pages do not query Activity'); }
  };
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => { root.render(React.createElement(ActivityPanel, { api, workstreamId: 'ws-1' })); });
    await act(async () => { root.render(React.createElement(ActivityPanel, { api, workstreamId: 'ws-2' })); await Promise.resolve(); await Promise.resolve(); });
    assert.equal([...timers.values()].filter((timer) => timer.delay === 3000).length, 1);
    await act(async () => { first.resolve({ ok: true, data: { items: [], nextCursor: 0, hasMore: false }, meta: {} }); await Promise.resolve(); });
    assert.equal([...timers.values()].filter((timer) => timer.delay === 3000).length, 1);
    const timer = [...timers.values()][0];
    await act(async () => { await timer.fn(); });
    assert.equal(calls.filter((payload) => payload.workstreamId === 'ws-2').length, 2);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('an authority reload that is pending during selection change cannot write the old workstream detail', async () => {
  const authorityList = deferred();
  const first = workstream();
  const second = { ...workstream(), id: 'ws-2', title: 'Second workstream', currentState: 'Second state' };
  let workstreamListCalls = 0;
  const api = {
    query(type, payload = {}) {
      if (type === 'workstream.list') {
        workstreamListCalls += 1;
        return workstreamListCalls === 1
          ? Promise.resolve({ ok: true, data: { items: [first, second] }, meta: {} })
          : authorityList.promise;
      }
      if (type === 'needs_owner.list') return Promise.resolve({ ok: true, data: { items: [] }, meta: {} });
      if (type === 'workstream.get') return Promise.resolve({ ok: true, data: payload.workstreamId === 'ws-2' ? second : first, meta: {} });
      throw new Error(`unexpected query ${type}`);
    }
  };
  let data;
  function Probe() {
    data = useWorkbenchData(api);
    return React.createElement('p', null, data.detailState.workstream?.title ?? 'none');
  }
  const view = await mount(React.createElement(Probe));
  await act(async () => { await data.selectWorkstream('ws-1'); });
  let pendingReload;
  await act(async () => { pendingReload = data.refreshAfterRunCommand('ws-1'); await Promise.resolve(); });
  assert.equal(workstreamListCalls, 2);
  await act(async () => { await data.selectWorkstream('ws-2'); });
  await act(async () => { authorityList.resolve({ ok: true, data: { items: [first, second] }, meta: {} }); await pendingReload; });
  assert.equal(data.selectedId, 'ws-2');
  assert.equal(data.detailState.workstream.id, 'ws-2');
  await unmount(view);
});
