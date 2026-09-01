import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ResumeBriefPanel } from '../web/src/components/ResumeBriefPanel.js';

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

function brief(overrides = {}) {
  return {
    workstreamId: 'ws-1', generatedAt: '2026-09-01T00:00:00Z',
    facts: { goal: 'Ship feature', nextAction: 'Write tests', currentPlan: [], blockers: [], currentState: null },
    run: null, checkpoint: null, needsOwner: [], decisions: [], memories: [], recentActivity: [],
    recommendations: [{ id: 'rec-1', kind: 'primary', action: 'Write tests', hypothesis: null, evidence: [] }],
    sourceVersions: [{ aggregateType: 'workstream', aggregateId: 'ws-1', aggregateVersion: 2 }],
    ...overrides
  };
}

function makeApi(briefData) {
  return { query: async (type) => type === 'resume_brief.get' ? { ok: true, data: briefData } : { ok: false, error: { code: 'not_found' } } };
}

async function render(api, workstreamId, handlers = {}) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(ResumeBriefPanel, { api, workstreamId, ...handlers })); });
  const panel = document.querySelector('[data-resume-brief-panel]');
  return { dom, root, panel };
}

async function cleanup(view) { await act(async () => { view.root.unmount(); }); view.dom.window.close(); }

test('panel renders brief goal, next action and recommendation', async (t) => {
  const api = makeApi(brief());
  const view = await render(api, 'ws-1');
  t.after(() => cleanup(view));
  assert.ok(view.panel);
  assert.match(view.panel.textContent, /Ship feature/);
  assert.match(view.panel.textContent, /Write tests/);
});

test('panel shows switch button when onSwitchRequest is provided', async (t) => {
  const switched = [];
  const api = makeApi(brief());
  const view = await render(api, 'ws-1', { onSwitchRequest: (id, b) => switched.push({ id, b }) });
  t.after(() => cleanup(view));
  const btn = view.panel.querySelector('[data-resume-brief-switch]');
  assert.ok(btn, 'switch button should exist');
  await act(async () => { btn.click(); });
  assert.equal(switched.length, 1);
  assert.equal(switched[0].id, 'ws-1');
});

test('panel shows no switch button without onSwitchRequest', async (t) => {
  const api = makeApi(brief());
  const view = await render(api, 'ws-1');
  t.after(() => cleanup(view));
  assert.equal(view.panel.querySelector('[data-resume-brief-switch]'), null);
});

test('panel shows error when query fails', async (t) => {
  const api = { query: async () => ({ ok: false, error: { code: 'storage_failure', retryable: false } }) };
  const view = await render(api, 'ws-1');
  t.after(() => cleanup(view));
  assert.match(view.panel.textContent, /could not load|Try again/i);
});

test('panel renders nothing when no workstreamId', async (t) => {
  const api = makeApi(brief());
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(ResumeBriefPanel, { api, workstreamId: null })); });
  t.after(async () => { await act(async () => { root.unmount(); }); dom.window.close(); });
  assert.equal(document.querySelector('[data-resume-brief-panel]'), null);
});
