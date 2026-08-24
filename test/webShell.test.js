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
    selectedId: null, tab: 'overview', formInput: '', loading: true, error: null, message: null, cursor: 0
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
  const api = { query() { return new Promise((resolve) => { resolveQuery = resolve; }); } };
  const root = createRoot(document.getElementById('root'));

  await act(async () => { root.render(React.createElement(App, { api })); });
  assert.match(document.body.textContent, /Loading workstreams/);
  assert.deepEqual([...document.querySelectorAll('main [aria-label]')].map((node) => node.getAttribute('aria-label')), [
    'Workstreams', 'Workbench', 'Activity'
  ]);

  await act(async () => { resolveQuery({ ok: true, data: { items: [] }, meta: { requestId: 'list-1' } }); });
  assert.match(document.body.textContent, /No workstreams yet/);
  assert.equal(document.body.textContent.includes('list-1'), false);
  await act(async () => { root.unmount(); });
  dom.window.close();
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
  assert.equal(calls, 2);
  assert.match(document.body.textContent, /No workstreams yet/);
  await act(async () => { root.unmount(); });
  dom.window.close();
});

test('web shell source does not persist or own domain DTOs', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../web/src/App.js', import.meta.url), 'utf8'));
  assert.equal(/(?:localStorage|sessionStorage|indexedDB)/.test(source), false);
  assert.equal(/(?:workstreams|artifacts|conversation)\s*[:=]/i.test(source), false);
});
