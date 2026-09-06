import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionDetail } from '../web/src/margin/SessionDetail.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://margin.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

async function renderDetail(api, session) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(SessionDetail, { api, session })); });
  return { dom, root };
}

async function cleanup(view) {
  await act(async () => { view.root.unmount(); });
  view.dom.window.close();
}

test('SessionDetail calls generateHandoff via the injected Core-backed api, not a UI-local implementation', async (t) => {
  const calls = [];
  const api = {
    generateHandoff: async (args) => { calls.push(args); return { ok: true, data: { markdown: '# Real Core Markdown', resumeSummary: summary() } }; },
    saveToWorkspace: async () => ({ ok: true, data: { path: 'x' } })
  };
  const view = await renderDetail(api, { id: 's1', agent: 'Codex', cwd: 'D:\\repo', updatedAt: null, summary: null });
  t.after(() => cleanup(view));
  await act(async () => {});
  assert.deepEqual(calls, [{ sessionId: 's1', repo: 'D:\\repo' }]);
  assert.equal(document.querySelector('.margin-handoff-preview'), null);
  assert.match(document.body.textContent, /Continue in another coding agent/);
  assert.match(document.body.textContent, /Goal/);
});

test('Copy checkpoint and Save to workspace both operate on the exact same full markdown', async (t) => {
  let savedMarkdown;
  let copiedMarkdown;
  const api = {
    generateHandoff: async () => ({ ok: true, data: { markdown: '# Shared Handoff Content', resumeSummary: summary() } }),
    saveToWorkspace: async ({ markdown }) => { savedMarkdown = markdown; return { ok: true, data: { path: 'D:\\repo\\.margin\\HANDOFF.md' } }; }
  };
  const view = await renderDetail(api, { id: 's1', agent: 'Codex', cwd: 'D:\\repo', updatedAt: null, summary: null });
  t.after(() => cleanup(view));
  globalThis.navigator.clipboard = { writeText: async (text) => { copiedMarkdown = text; } };
  await act(async () => {});

  await act(async () => {
    [...document.querySelectorAll('.margin-handoff-actions button')].find((button) => button.textContent === 'Copy checkpoint').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    [...document.querySelectorAll('.margin-handoff-actions button')].find((button) => button.textContent === 'Save to workspace').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.equal(savedMarkdown, '# Shared Handoff Content');
  assert.equal(copiedMarkdown, '# Shared Handoff Content');
  assert.equal(savedMarkdown, copiedMarkdown);
  assert.ok(document.body.textContent.includes('Saved current checkpoint to .margin/HANDOFF.md'));
});

test('SessionDetail keeps full checkpoint collapsed, exposes summary and permits copy for unknown applicability', async (t) => {
  let copied;
  const api = {
    generateHandoff: async () => ({ ok: true, data: { markdown: '# Full checkpoint', resumeSummary: summary() } }),
    saveToWorkspace: async () => ({ ok: true, data: { path: 'x' } })
  };
  const view = await renderDetail(api, { id: 's1', agent: 'Codex', cwd: 'D:\\repo', updatedAt: null, summary: null });
  t.after(() => cleanup(view));
  globalThis.navigator.clipboard = { writeText: async (text) => { copied = text; } };
  await act(async () => {});
  assert.equal(document.querySelector('.margin-handoff-preview'), null);
  assert.match(document.body.textContent, /Check first/);
  await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent === 'Copy checkpoint').click(); });
  assert.equal(copied, '# Full checkpoint');
  await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent === 'View full checkpoint').click(); });
  assert.match(document.querySelector('.margin-handoff-preview').textContent, /Full checkpoint/);
});

test('SessionDetail shows a retryable generation error and visible copy failure', async (t) => {
  let attempts = 0;
  const api = {
    generateHandoff: async () => ++attempts === 1 ? { ok: false, error: { message: 'Generation failed' } } : { ok: true, data: { markdown: '# Recovered', resumeSummary: summary() } },
    saveToWorkspace: async () => ({ ok: false, error: { message: 'Save failed' } })
  };
  const view = await renderDetail(api, { id: 's1', agent: 'Codex', cwd: 'D:\\repo', updatedAt: null, summary: null });
  t.after(() => cleanup(view));
  await act(async () => {});
  assert.match(document.body.textContent, /Generation failed/);
  await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent === 'Retry').click(); });
  assert.match(document.body.textContent, /Copy checkpoint/);
  await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent === 'Copy checkpoint').click(); });
  assert.match(document.body.textContent, /Couldn’t copy checkpoint/);
  await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save to workspace').click(); });
  assert.match(document.body.textContent, /Save failed/);
});

test('SessionDetail labels automatic fresh generation and keeps checkpoint actions unavailable until it completes', async (t) => {
  let resolve;
  const api = {
    generateHandoff: () => new Promise((done) => { resolve = done; }),
    saveToWorkspace: async () => ({ ok: true, data: { path: 'x' } })
  };
  const view = await renderDetail(api, { id: 's1', agent: 'Codex', cwd: 'D:\\repo', updatedAt: null, summary: null });
  t.after(() => cleanup(view));
  assert.match(document.body.textContent, /Preparing fresh checkpoint/);
  assert.equal([...document.querySelectorAll('button')].some((button) => /Copy checkpoint|Save to workspace/.test(button.textContent)), false);
  await act(async () => { resolve({ ok: true, data: { markdown: '# Ready', resumeSummary: summary() } }); });
  assert.match(document.body.textContent, /Copy checkpoint/);
});

function summary() {
  return {
    goal: { text: 'Historical goal', confidence: 'Inferred' },
    progress: [{ text: 'Assistant-reported milestone: implementation complete.', confidence: 'Inferred', temporalScope: 'historical', kind: 'assistant-report' }],
    currentApplicability: { status: 'unknown', text: 'Check first: Historical intent has no structured repo target for reconciliation.' },
    currentValidation: { status: 'unknown', text: 'Current validation: unknown; historical tests have not been rerun.' }
  };
}
