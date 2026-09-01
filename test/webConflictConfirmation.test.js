import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ConflictConfirmationPanel } from '../web/src/components/ConflictConfirmationPanel.js';
import { createConflict } from '../web/src/conflictState.js';

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

async function renderConflict(conflict, handlers = {}) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  let onKeepCurrent = handlers.onKeepCurrent ?? (() => {});
  let onReapply = handlers.onReapply ?? (() => {});
  let onEdit = handlers.onEdit ?? (() => {});
  await act(async () => {
    root.render(React.createElement(ConflictConfirmationPanel, { conflict, onKeepCurrent, onReapply, onEdit, submitting: handlers.submitting ?? false }));
  });
  const panel = document.querySelector('[data-conflict-panel]');
  return { dom, root, panel };
}

async function cleanup(view) {
  await act(async () => { view.root.unmount(); });
  view.dom.window.close();
}

test('createConflict rejects invalid input', () => {
  assert.throws(() => createConflict(null), /invalid_conflict/);
  assert.throws(() => createConflict({ unknownField: 'x', currentVersion: 1 }), /invalid_conflict/);
  assert.throws(() => createConflict({ entityLabel: 'x', originalValue: 'a', currentValue: 'b', proposedValue: 'c', currentVersion: 'not-an-int' }), /invalid_conflict/);
});

test('createConflict returns frozen view object with exact keys', () => {
  const c = createConflict({ entityLabel: 'Title', originalValue: 'Old', currentValue: 'Server', proposedValue: 'Mine', currentVersion: 3 });
  assert.equal(c.entityLabel, 'Title');
  assert.equal(c.currentVersion, 3);
  assert.ok(Object.isFrozen(c));
});

test('panel renders Original, Current and Proposed labels', async (t) => {
  const conflict = createConflict({ entityLabel: 'Goal', originalValue: 'Old goal', currentValue: 'New goal', proposedValue: 'My goal', currentVersion: 2 });
  const view = await renderConflict(conflict);
  t.after(() => cleanup(view));
  assert.match(view.panel.textContent, /Original/);
  assert.match(view.panel.textContent, /Current/);
  assert.match(view.panel.textContent, /Proposed/);
  assert.match(view.panel.textContent, /Old goal/);
  assert.match(view.panel.textContent, /New goal/);
  assert.match(view.panel.textContent, /My goal/);
});

test('all three action buttons fire callbacks in order', async (t) => {
  const actions = [];
  const conflict = createConflict({ entityLabel: 'Goal', originalValue: 'a', currentValue: 'b', proposedValue: 'c', currentVersion: 5 });
  const view = await renderConflict(conflict, {
    onKeepCurrent: () => actions.push('keep-current'),
    onReapply: (v) => actions.push(`reapply:${v}`),
    onEdit: () => actions.push('edit')
  });
  t.after(() => cleanup(view));
  const click = (sel) => act(async () => { view.panel.querySelector(`[data-conflict-action="${sel}"]`).click(); });
  await click('keep-current');
  await click('reapply');
  await click('edit');
  assert.deepEqual(actions, ['keep-current', 'reapply:5', 'edit']);
});

test('buttons are disabled while submitting and no action fires', async (t) => {
  const actions = [];
  const conflict = createConflict({ entityLabel: 'Goal', originalValue: 'a', currentValue: 'b', proposedValue: 'c', currentVersion: 1 });
  const view = await renderConflict(conflict, {
    submitting: true,
    onKeepCurrent: () => actions.push('keep-current'),
    onReapply: () => actions.push('reapply'),
    onEdit: () => actions.push('edit')
  });
  t.after(() => cleanup(view));
  const buttons = [...view.panel.querySelectorAll('button')];
  assert.ok(buttons.every((b) => b.disabled));
  assert.deepEqual(actions, []);
});

test('panel renders nothing when conflict is null', async (t) => {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(ConflictConfirmationPanel, { conflict: null })); });
  t.after(async () => { await act(async () => { root.unmount(); }); dom.window.close(); });
  assert.equal(document.querySelector('[data-conflict-panel]'), null);
});
