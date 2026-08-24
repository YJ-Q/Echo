import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../web/src/App.js';
import { ConversationPanel } from '../web/src/components/ConversationPanel.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  return dom;
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function mount(element) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(element); });
  return { root, dom };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function unmount(view) {
  await act(async () => { view.root.unmount(); });
  view.dom.window.close();
}

test('conversation is disabled without an authoritative running Run and uses only a closed turn payload', async () => {
  const calls = [];
  const api = {
    async query() { return { ok: true, data: { items: [{ id: 'run-1', status: 'running' }] }, meta: {} }; },
    async interact(payload) { calls.push(payload); return { ok: true, data: { message: 'Done', toolResults: [] }, meta: {} }; }
  };
  const view = await mount(React.createElement(ConversationPanel, { api, workstreamId: null }));
  assert.equal(document.querySelector('[data-conversation-submit]').disabled, true);
  await act(async () => { view.root.render(React.createElement(ConversationPanel, { api, workstreamId: 'ws-1' })); await flushEffects(); });
  const input = document.querySelector('[data-conversation-input]');
  assert.equal(input.disabled, false);
  await act(async () => { input.value = 'Continue'; input.dispatchEvent(new window.Event('input', { bubbles: true })); await flushEffects(); });
  assert.equal(document.querySelector('[data-conversation-submit]').disabled, false);
  await act(async () => { document.querySelector('[data-conversation-submit]').click(); await flushEffects(); });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['message', 'requestId', 'runId', 'workstreamId']);
  assert.equal(calls[0].workstreamId, 'ws-1');
  assert.equal(calls[0].runId, 'run-1');
  await unmount(view);
});

test('conversation refreshes all authority after a turn and never writes an older selection result', async () => {
  const turn = deferred();
  const refreshes = [];
  const api = {
    async query(_type, payload) { return { ok: true, data: { items: [{ id: `run-${payload.workstreamId}`, status: 'running' }] }, meta: {} }; },
    interact() { return turn.promise; }
  };
  const view = await mount(React.createElement(ConversationPanel, {
    api, workstreamId: 'ws-1', onAuthoritativeRefresh: async (id) => { refreshes.push(id); }
  }));
  await act(async () => { await flushEffects(); });
  await act(async () => {
    const input = document.querySelector('[data-conversation-input]');
    input.value = 'First'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushEffects();
    document.querySelector('[data-conversation-submit]').click();
    view.root.render(React.createElement(ConversationPanel, { api, workstreamId: 'ws-2', onAuthoritativeRefresh: async (id) => { refreshes.push(id); } }));
    await flushEffects();
  });
  await act(async () => { turn.resolve({ ok: true, data: { message: 'Stale answer', toolResults: [{ toolName: 'x', prompt: 'private' }] }, meta: {} }); await flushEffects(); });
  assert.equal(document.body.textContent.includes('Stale answer'), false);
  assert.deepEqual(refreshes, ['ws-1']);
  await unmount(view);
});

test('App refreshes every authoritative panel and the activity cursor after an interaction turn', async () => {
  const calls = [];
  const api = {
    async query(type, payload = {}) {
      calls.push(['query', type, payload?.workstreamId ?? null, payload?.afterCursor ?? null]);
      if (type === 'workstream.list') return { ok: true, data: { items: [{ id: 'ws-1', title: 'Active', status: 'running' }] }, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: { id: payload.workstreamId, title: 'Active', status: 'running' }, meta: {} };
      if (type === 'run.list') return { ok: true, data: { items: [{ id: 'run-1', status: 'running' }] }, meta: {} };
      if (type === 'artifact.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor + 1 }, meta: {} };
      return { ok: false, error: { code: 'invalid_request', retryable: false }, meta: {} };
    },
    async events(type, payload = {}) {
      calls.push(['events', type, payload?.workstreamId ?? null, payload?.afterCursor ?? null]);
      return { ok: true, data: { items: [], nextCursor: payload.afterCursor + 1, hasMore: false }, meta: {} };
    },
    async interact() {
      calls.push(['interact', 'interaction.submit', 'ws-1', null]);
      return { ok: true, data: { message: 'Done', toolResults: [] }, meta: {} };
    }
  };
  const view = await mount(React.createElement(App, { api }));
  await act(async () => { await flushEffects(); });
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); await flushEffects(); });
  calls.length = 0;

  await act(async () => {
    const input = document.querySelector('[data-conversation-input]');
    input.value = 'Continue';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushEffects();
    document.querySelector('[data-conversation-submit]').click();
    await flushEffects(8);
  });

  const summarized = calls.map(([kind, type, workstreamId]) => [kind, type, workstreamId]);
  assert.ok(summarized.some((call) => call[0] === 'interact'), 'submits the interaction');
  assert.ok(summarized.some((call) => call[1] === 'workstream.list'), 'refreshes Workstreams');
  assert.ok(summarized.some((call) => call[1] === 'workstream.get' && call[2] === 'ws-1'), 'refreshes selected Workstream');
  assert.ok(summarized.some((call) => call[1] === 'needs_owner.list' && call[2] === null), 'refreshes global NeedsOwner grouping');
  assert.ok(summarized.some((call) => call[1] === 'needs_owner.list' && call[2] === 'ws-1'), 'refreshes selected NeedsOwner panel');
  assert.ok(summarized.some((call) => call[1] === 'run.list' && call[2] === 'ws-1'), 'refreshes Runs');
  assert.ok(summarized.some((call) => call[1] === 'artifact.list' && call[2] === 'ws-1'), 'refreshes Artifacts');
  assert.ok(summarized.some((call) => call[0] === 'events' && call[1] === 'event.list' && call[2] === 'ws-1'), 'refreshes Activity/Event cursor');
  await unmount(view);
});

test('App refreshes global and current authority when an interaction resolves after selection changes', async () => {
  const turn = deferred();
  const calls = [];
  const workstreams = [
    { id: 'ws-1', title: 'Old workstream', status: 'running', priority: 1, updatedAt: '2026-08-24T00:00:00Z' },
    { id: 'ws-2', title: 'Current workstream', status: 'running', priority: 2, updatedAt: '2026-08-24T00:01:00Z' }
  ];
  const api = {
    async query(type, payload = {}) {
      calls.push(['query', type, payload?.workstreamId ?? null, payload?.afterCursor ?? null]);
      if (type === 'workstream.list') return { ok: true, data: { items: workstreams }, meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'workstream.get') {
        const item = workstreams.find((workstream) => workstream.id === payload.workstreamId);
        return { ok: true, data: { ...item, currentState: `${item.title} authoritative state` }, meta: {} };
      }
      if (type === 'run.list') return { ok: true, data: { items: [{ id: `run-${payload.workstreamId}`, status: 'running' }] }, meta: {} };
      if (type === 'artifact.list') return { ok: true, data: { items: [] }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor + 1 }, meta: {} };
      return { ok: false, error: { code: 'invalid_request', retryable: false }, meta: {} };
    },
    async events(type, payload = {}) {
      calls.push(['events', type, payload?.workstreamId ?? null, payload?.afterCursor ?? null]);
      return { ok: true, data: { items: [], nextCursor: payload.afterCursor + 1, hasMore: false }, meta: {} };
    },
    interact() {
      calls.push(['interact', 'interaction.submit', 'ws-1', null]);
      return turn.promise;
    }
  };
  const view = await mount(React.createElement(App, { api }));
  try {
    await act(async () => { await flushEffects(); });
    await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); await flushEffects(); });
    await act(async () => {
      const input = document.querySelector('[data-conversation-input]');
      input.value = 'Continue old work';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await flushEffects();
      document.querySelector('[data-conversation-submit]').click();
      await flushEffects();
      document.querySelector('[data-workstream-id="ws-2"]').click();
      await flushEffects();
    });
    calls.length = 0;

    await act(async () => {
      turn.resolve({ ok: true, data: { message: 'Old answer', toolResults: [] }, meta: {} });
      await flushEffects(10);
    });

    const summarized = calls.map(([kind, type, workstreamId]) => [kind, type, workstreamId]);
    assert.equal(document.querySelector('[data-workstream-id="ws-2"]').getAttribute('aria-current'), 'true');
    assert.match(document.body.textContent, /Current workstream authoritative state/);
    assert.equal(document.body.textContent.includes('Old workstream authoritative state'), false);
    assert.equal(document.body.textContent.includes('Old answer'), false);
    assert.ok(summarized.some((call) => call[1] === 'workstream.list'), 'refreshes global Workstreams');
    assert.ok(summarized.some((call) => call[1] === 'needs_owner.list' && call[2] === null), 'refreshes global NeedsOwner');
    assert.ok(summarized.some((call) => call[1] === 'workstream.get' && call[2] === 'ws-1'), 'requeries old Workstream without selecting it');
    assert.ok(summarized.some((call) => call[1] === 'workstream.get' && call[2] === 'ws-2'), 'refreshes current Workstream');
    assert.ok(summarized.some((call) => call[1] === 'run.list' && call[2] === 'ws-2'), 'refreshes current Runs');
    assert.ok(summarized.some((call) => call[1] === 'artifact.list' && call[2] === 'ws-2'), 'refreshes current Artifacts');
    assert.ok(summarized.some((call) => call[0] === 'events' && call[1] === 'event.list' && call[2] === 'ws-2'), 'refreshes current Activity/Event cursor');
  } finally {
    await unmount(view);
  }
});

test('conversation serializes submits and renders bounded safe tool evidence only', async () => {
  const pending = deferred();
  let calls = 0;
  const api = {
    async query() { return { ok: true, data: { items: [{ id: 'run-1', status: 'running' }] }, meta: {} }; },
    interact() { calls += 1; return pending.promise; }
  };
  const view = await mount(React.createElement(ConversationPanel, { api, workstreamId: 'ws-1' }));
  await act(async () => { await flushEffects(); });
  await act(async () => {
    const input = document.querySelector('[data-conversation-input]');
    input.value = 'Continue'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushEffects();
    document.querySelector('[data-conversation-submit]').click();
    document.querySelector('[data-conversation-submit]').click();
  });
  assert.equal(calls, 1);
  await act(async () => { pending.resolve({ ok: true, data: { message: 'Done', toolResults: [{ toolName: 'tool', code: 'ok', auditId: 'audit-1', entityId: 'entity-1', stack: 'private', prompt: 'private' }] }, meta: {} }); await flushEffects(); });
  assert.match(document.body.textContent, /tool/);
  assert.equal(document.body.textContent.includes('private'), false);
  await unmount(view);
});
