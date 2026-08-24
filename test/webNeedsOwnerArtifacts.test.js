import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../web/src/App.js';

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

function deferred() {
  let resolve;
  return { promise: new Promise((next) => { resolve = next; }), resolve };
}

function workstream(id) {
  return {
    id, title: `Workstream ${id}`, goal: 'Ship safely', status: 'ready', priority: 1,
    currentState: 'Waiting', currentPlan: [], nextAction: 'Review', blockers: [], autonomyLevel: 1,
    workspaceReference: null, latestCheckpoint: null, activeRun: null, version: 4, updatedAt: '2026-08-24T00:00:00Z'
  };
}

function need(id, workstreamId, options = [{ id: 'approve', label: 'Approve', consequenceSummary: 'The Run continues.' }]) {
  return {
    id, workstreamId, runId: 'run-1', type: 'approval', reason: 'Owner approval is required.', options,
    consequenceSummary: 'The work remains paused.', contextSummary: 'The final check is ready.', status: 'open',
    resolution: null, version: 3, createdAt: '2026-08-24T00:00:00Z', resolvedAt: null
  };
}

function artifact(id, uri) {
  return {
    id, workstreamId: 'ws-1', runId: 'run-1', type: 'report', title: `Report ${id}`,
    source: { createdBy: 'worker', runtimeReference: { kind: 'pi', id: 'runtime-1' } },
    resourceReference: { uri, contentHash: 'sha256:abc' }, metadata: { safe: 'metadata', nested: { value: 1 } },
    previewMetadata: { format: 'markdown' }, version: 7, createdAt: '2026-08-24T01:00:00Z', updatedAt: '2026-08-24T01:00:00Z'
  };
}

async function mount(api) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App, { api })); });
  return { dom, root };
}

async function unmount(view) {
  await act(async () => { view.root.unmount(); });
  view.dom.window.close();
}

test('NeedsOwner renders the first-class Contract item and removes it only after its authoritative resolution query', async () => {
  const calls = [];
  const command = deferred();
  let unresolved = [need('need-1', 'ws-1')];
  const api = {
    async query(type, payload = {}) {
      calls.push({ kind: 'query', type, payload });
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream('ws-1')] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream(payload.workstreamId), meta: {} };
      if (type === 'needs_owner.list') return { ok: true, data: { items: unresolved.filter((item) => !payload.workstreamId || item.workstreamId === payload.workstreamId), nextCursor: null }, meta: {} };
      if (type === 'artifact.list') return { ok: true, data: { items: [], nextCursor: null }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0, hasMore: false }, meta: {} };
      if (type === 'run.list') return { ok: true, data: { items: [], nextCursor: null }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) { calls.push({ kind: 'event', payload }); return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} }; },
    command(type, payload, options) { calls.push({ kind: 'command', type, payload, options }); return command.promise; }
  };
  const view = await mount(api);
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });

  const panel = document.querySelector('[data-needs-owner-panel]');
  assert.match(panel.textContent, /Owner approval is required\./);
  assert.match(panel.textContent, /The work remains paused\./);
  assert.match(panel.textContent, /The final check is ready\./);
  await act(async () => { document.querySelector('[data-needs-owner-option="need-1"]').value = 'approve'; document.querySelector('[data-needs-owner-option="need-1"]').dispatchEvent(new window.Event('change', { bubbles: true })); });
  await act(async () => { document.querySelector('[data-needs-owner-resolve="need-1"]').click(); });
  assert.match(panel.textContent, /Owner approval is required\./);

  unresolved = [];
  await act(async () => {
    command.resolve({ ok: true, data: { ...need('need-1', 'ws-1'), status: 'resolved', version: 4 }, meta: {} });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const sent = calls.find((call) => call.kind === 'command');
  assert.equal(sent.type, 'needs_owner.resolve');
  assert.deepEqual(sent.payload, { needsOwnerId: 'need-1', optionId: 'approve' });
  assert.equal(sent.options.expectedVersion, 3);
  assert.match(sent.options.requestId, /^web_needs_owner_resolve_/);
  assert.match(sent.options.idempotencyKey, /^web_needs_owner_resolve_intent_/);
  assert.equal(document.body.textContent.includes('Owner approval is required.'), false);
  assert.ok(calls.filter((call) => call.type === 'needs_owner.list' && call.payload.workstreamId === 'ws-1').length >= 2);
  assert.equal(calls.some((call) => call.type?.includes('decision') || call.type?.includes('interaction')), false);
  await unmount(view);
});

test('NeedsOwner permits a textual no-option resolution and stale resolution completion cannot reload another selection', async () => {
  const pending = deferred();
  const calls = [];
  const api = {
    async query(type, payload = {}) {
      calls.push({ kind: 'query', type, payload });
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream('ws-1'), workstream('ws-2')] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream(payload.workstreamId), meta: {} };
      if (type === 'needs_owner.list') {
        const items = payload.workstreamId === 'ws-1' ? [need('need-no-options', 'ws-1', [])] : [];
        return { ok: true, data: { items, nextCursor: null }, meta: {} };
      }
      if (type === 'artifact.list' || type === 'run.list') return { ok: true, data: { items: [], nextCursor: null }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0, hasMore: false }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) { calls.push({ kind: 'event', payload }); return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} }; },
    command(type, payload, options) { calls.push({ kind: 'command', type, payload, options }); return pending.promise; }
  };
  const view = await mount(api);
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  const response = document.querySelector('[data-needs-owner-summary="need-no-options"]');
  await act(async () => { response.value = 'Proceed with the documented exception.'; response.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await act(async () => { document.querySelector('[data-needs-owner-resolve="need-no-options"]').click(); });
  await act(async () => { document.querySelector('[data-workstream-id="ws-2"]').click(); });
  const afterSelection = calls.length;
  await act(async () => { pending.resolve({ ok: false, error: { code: 'version_conflict' }, meta: {} }); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(document.querySelector('[data-workstream-id="ws-2"]').getAttribute('aria-current'), 'true');
  assert.equal(document.body.textContent.includes('Owner approval is required.'), false);
  assert.equal(calls.slice(afterSelection).some((call) => call.payload?.workstreamId === 'ws-1'), false);
  const sent = calls.find((call) => call.kind === 'command');
  assert.deepEqual(sent.payload, { needsOwnerId: 'need-no-options', resolutionSummary: 'Proceed with the documented exception.' });
  await unmount(view);
});

test('Artifacts render Contract fields and only make safe https resource references clickable', async () => {
  const artifacts = [
    artifact('safe', 'https://example.test/report'), artifact('file', 'file:///D:/secret.txt'),
    artifact('path', 'D:/Echo/report.txt'), artifact('unknown', 'margin://artifact/one'), artifact('invalid', 'not a url')
  ];
  const api = {
    async query(type, payload = {}) {
      if (type === 'workstream.list') return { ok: true, data: { items: [workstream('ws-1')] }, meta: {} };
      if (type === 'workstream.get') return { ok: true, data: workstream(payload.workstreamId), meta: {} };
      if (type === 'needs_owner.list' || type === 'run.list') return { ok: true, data: { items: [], nextCursor: null }, meta: {} };
      if (type === 'artifact.list') return { ok: true, data: { items: artifacts, nextCursor: null }, meta: {} };
      if (type === 'activity.list') return { ok: true, data: { items: [], nextCursor: payload.afterCursor ?? 0, hasMore: false }, meta: {} };
      throw new Error(`unexpected query ${type}`);
    },
    async events(_type, payload) { return { ok: true, data: { items: [], nextCursor: payload.afterCursor, hasMore: false }, meta: {} }; }
  };
  const view = await mount(api);
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').click(); });
  const panel = document.querySelector('[data-artifact-panel]');
  for (const value of ['Report safe', 'report', 'worker', 'run-1', 'Version: 7', '2026-08-24T01:00:00Z', 'metadata', 'markdown', 'sha256:abc']) assert.match(panel.textContent, new RegExp(value));
  const links = [...panel.querySelectorAll('a')];
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.test/report');
  assert.equal(links[0].target, '_blank');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.match(panel.textContent, /file:\/\/\/D:\/secret\.txt/);
  assert.match(panel.textContent, /margin:\/\/artifact\/one/);
  assert.equal(document.body.textContent.includes('file-content'), false);
  await unmount(view);
});
