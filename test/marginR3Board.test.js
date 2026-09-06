import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { groupSessions, SessionBoard, UsageBar } from '../web/src/margin/SessionBoard.js';
import { MarginApp } from '../web/src/margin/MarginApp.js';

const sessions = [
  { id: 'a', agent: 'Codex', workspaceKey: 'git:one', workspaceName: 'one', cwd: 'D:\\one', label: 'A deliberately long session title that must remain one visual row', updatedAt: '2026-09-06T10:00:00Z', bytes: 4000 },
  { id: 'b', agent: 'Claude', workspaceKey: 'git:one', workspaceName: 'one', cwd: 'D:\\one', label: 'Second', updatedAt: '2026-09-06T09:00:00Z', bytes: 2000 },
  { id: 'c', agent: 'Codex', workspaceKey: 'git:two', workspaceName: 'two', cwd: 'D:\\two', label: 'Third', updatedAt: '2026-09-06T08:00:00Z', bytes: 1000 },
];

test('R3 board groups only by the selected mode and preserves source session order', () => {
  assert.deepEqual(groupSessions(sessions, 'Workspace').map((g) => [g.label, g.sessions.map((s) => s.id)]), [['one', ['a', 'b']], ['two', ['c']]]);
  assert.deepEqual(groupSessions(sessions, 'Agent').map((g) => [g.label, g.sessions.map((s) => s.id)]), [['Codex', ['a', 'c']], ['Claude', ['b']]]);
  assert.deepEqual(groupSessions(sessions, 'Sessions')[0].sessions.map((s) => s.id), ['a', 'b', 'c']);
});

test('R3.3 window controls keep content expansion first and Quit at the far right', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root')); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(UsageBar, { resourceStatus: { agents: [{ agent: 'codex', resources: [{ windowDurationMinutes: 300, percentUsed: 59, resetsAt: 1 }, { windowDurationMinutes: 10080, percentUsed: 51, resetsAt: 2 }] }, { agent: 'claude-code', unavailable: true }] }, expanded: false, settings: {}, alwaysOnTop: false, onToggle() {}, onPin() {}, onHide() {}, onQuit() {} })));
  assert.deepEqual([...document.querySelectorAll('.margin-control-dock button')].map((button) => button.getAttribute('aria-label')), ['Expand sessions', 'Pin', 'Hide', 'Quit']);
  assert.equal(document.querySelectorAll('[data-agent="codex"]').length, 1);
  assert.match(document.querySelector('[data-agent="codex"]').textContent, /Codex · 5h 59% · 7d 51%/);
  assert.match(document.querySelector('[data-agent="claude-code"]').textContent, /^Claude —$/);
  assert.equal(document.body.textContent.includes('Today'), false);
  assert.equal(document.body.textContent.includes(' W'), false);
});

test('resource bar refreshes its native snapshot when the Board expands', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let reads = 0;
  const api = { listSessions: async () => ({ ok: true, data: { sessions: [] } }), getResourceStatus: async () => ({ agents: [{ agent: 'codex', resources: [{ windowDurationMinutes: 300, percentUsed: ++reads, resetsAt: 1 }] }, { agent: 'claude-code', unavailable: true }] }) };
  const root = createRoot(document.getElementById('root')); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => { root.render(React.createElement(MarginApp, { api })); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { document.querySelector('.margin-usage-toggle').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(reads, 2);
  assert.match(document.querySelector('[data-agent="codex"]').textContent, /5h 2%/);
});

test('resource bar keeps last-known-good and never flickers to — when a later refresh fails', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let calls = 0;
  const api = { listSessions: async () => ({ ok: true, data: { sessions: [] } }), getResourceStatus: async () => { calls += 1; return calls === 1 ? { agents: [{ agent: 'codex', resources: [{ windowDurationMinutes: 300, percentUsed: 71, resetsAt: 1 }] }, { agent: 'claude-code', unavailable: true }] } : { agents: [{ agent: 'codex', unavailable: true, resources: [] }, { agent: 'claude-code', unavailable: true }] }; } };
  const root = createRoot(document.getElementById('root')); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => { root.render(React.createElement(MarginApp, { api })); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.match(document.querySelector('[data-agent="codex"]').textContent, /Codex · 5h 71%/);
  // Expand arms the focus/interval refresh path; the expand refresh itself reads unavailable.
  await act(async () => { document.querySelector('.margin-usage-toggle').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.match(document.querySelector('[data-agent="codex"]').textContent, /Codex · 5h 71%/);
  // A focus-driven refresh also reads unavailable; the value must stay put, not flicker to —.
  await act(async () => { window.dispatchEvent(new window.Event('focus')); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.match(document.querySelector('[data-agent="codex"]').textContent, /Codex · 5h 71%/);
  assert.doesNotMatch(document.querySelector('[data-agent="codex"]').textContent, /Codex —/);
  assert.equal(calls, 3);
});

test('R3 board Copy and Save each use the exact Core handoff markdown', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator }); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let copied; let saved; const api = { generateHandoff: async () => ({ ok: true, data: { markdown: '# Core handoff' } }), saveToWorkspace: async ({ markdown }) => { saved = markdown; return { ok: true, data: { path: 'x' } }; } };
  globalThis.navigator.clipboard = { writeText: async (text) => { copied = text; } };
  const root = createRoot(document.getElementById('root')); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(SessionBoard, { api, sessions: [sessions[0]], loading: false, error: null, onRetry() {} })));
  await act(async () => { document.querySelector('.margin-row-actions button').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { document.querySelectorAll('.margin-row-actions button')[1].click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(copied, '# Core handoff'); assert.equal(saved, '# Core handoff');
});

test('R3 board treats timestamp-only discoveries as neutral historical sessions', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root')); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(SessionBoard, { api: {}, sessions: [sessions[0]], loading: false, error: null, onRetry() {} })));
  const dot = document.querySelector('.margin-status-dot');
  assert.ok(dot.classList.contains('is-neutral'));
  assert.ok(!dot.classList.contains('is-recent'));
  assert.match(dot.title, /no runtime state/i);
});
