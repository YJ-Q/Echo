import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { groupSessionsByWorkspace, RecentSessionsList } from '../web/src/margin/RecentSessionsList.js';

test('grouped recent sessions order workspaces and cards by newest update and preserve selection ids', async (t) => {
  const sessions = [
    { id: 'old', workspaceKey: 'git:margin', workspaceName: 'margin', label: 'Older implementation', agent: 'Codex', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'new', workspaceKey: 'git:margin', workspaceName: 'margin', label: 'New research', agent: 'Codex', branch: 'main', updatedAt: '2026-01-03T00:00:00Z' },
    { id: 'other', workspaceKey: 'git:other', workspaceName: 'other-repo', label: 'Other task', agent: 'Codex', updatedAt: '2026-01-02T00:00:00Z' },
  ];
  const groups = groupSessionsByWorkspace(sessions);
  assert.deepEqual(groups.map(group => [group.workspaceName, group.sessions.map(session => session.id)]), [['margin', ['new', 'old']], ['other-repo', ['other']]]);
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const selected = [];
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => root.render(React.createElement(RecentSessionsList, { sessions, loading: false, error: null, selectedId: null, onSelect: id => selected.push(id), onRetry() {} })));
  assert.match(document.body.textContent, /margin.*2 sessions/s);
  assert.equal(document.querySelectorAll('.margin-session-card')[0].textContent.includes('New research'), true);
  await act(async () => document.querySelector('[data-session-id="other"]').click());
  assert.deepEqual(selected, ['other']);
});
