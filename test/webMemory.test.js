import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryPanel } from '../web/src/components/MemoryPanel.js';

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

function memItem(id, status = 'active') {
  return { id, workstreamId: 'ws-1', content: `Memory content ${id}`, lifecycleStatus: status, source: { kind: 'agent' }, version: 1, createdAt: '2026-09-01T00:00:00Z' };
}

function makeApi(items = [], commandResult = { ok: true, data: {} }) {
  return {
    query: async (type) => {
      if (type === 'memory.list' || type === 'memory.search') return { ok: true, data: { items } };
      return { ok: false, error: { code: 'not_found' } };
    },
    command: async () => commandResult
  };
}

async function render(api, workstreamId = 'ws-1', handlers = {}) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(MemoryPanel, { api, workstreamId, ...handlers })); });
  const panel = document.querySelector('[data-memory-panel]');
  return { dom, root, panel };
}

async function cleanup(v) { await act(async () => { v.root.unmount(); }); v.dom.window.close(); }

test('panel renders active memory items', async (t) => {
  const view = await render(makeApi([memItem('m1'), memItem('m2')]));
  t.after(() => cleanup(view));
  assert.ok(view.panel.querySelector('[data-memory-item="m1"]'));
  assert.ok(view.panel.querySelector('[data-memory-item="m2"]'));
  assert.match(view.panel.textContent, /Memory content m1/);
});

test('active item shows Archive button, candidate shows Confirm, archive shows Restore', async (t) => {
  const items = [memItem('ma', 'active'), memItem('mc', 'candidate'), memItem('mr', 'archive')];
  const view = await render(makeApi(items));
  t.after(() => cleanup(view));
  assert.ok(view.panel.querySelector('[data-memory-archive="ma"]'));
  assert.ok(view.panel.querySelector('[data-memory-confirm="mc"]'));
  assert.ok(view.panel.querySelector('[data-memory-restore="mr"]'));
});

test('panel shows empty message when no items', async (t) => {
  const view = await render(makeApi([]));
  t.after(() => cleanup(view));
  assert.match(view.panel.textContent, /No memories found/);
});

test('panel renders nothing when workstreamId is null', async (t) => {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(MemoryPanel, { api: makeApi(), workstreamId: null })); });
  t.after(async () => { await act(async () => { root.unmount(); }); dom.window.close(); });
  assert.equal(document.querySelector('[data-memory-panel]'), null);
});
