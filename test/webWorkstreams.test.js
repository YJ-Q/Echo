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

function workstream(id, status, extra = {}) {
  return {
    id, title: `Title ${id}`, goal: `Goal ${id}`, status, priority: 3,
    currentState: `State ${id}`, currentPlan: [`Plan ${id}`], nextAction: `Next ${id}`,
    blockers: [`Blocker ${id}`], autonomyLevel: 1,
    workspaceReference: { kind: 'local_path', path: `D:/Echo/${id}` },
    latestCheckpoint: { id: `checkpoint-${id}`, stateDigest: `digest-${id}` },
    activeRun: { id: `run-${id}`, status: 'running' }, version: 2, updatedAt: `2026-08-24T00:00:0${id.slice(-1)}Z`,
    ...extra
  };
}

function createServer(items, needs = []) {
  const calls = [];
  const details = new Map(items.map((item) => [item.id, item]));
  return {
    calls,
    api: {
      async query(type, payload = {}) {
        calls.push({ kind: 'query', type, payload });
        if (type === 'workstream.list') return { ok: true, data: { items: [...details.values()] }, meta: {} };
        if (type === 'needs_owner.list') return { ok: true, data: { items: needs }, meta: {} };
        if (type === 'workstream.get') return { ok: true, data: details.get(payload.workstreamId), meta: {} };
        throw new Error(`Unexpected query ${type}`);
      },
      async command(type, payload, options) {
        calls.push({ kind: 'command', type, payload, options });
        if (type !== 'workstream.create') throw new Error(`Unexpected command ${type}`);
        const created = workstream('ws-created', 'ready', { ...payload, title: payload.title, goal: payload.goal });
        details.set(created.id, created);
        return { ok: true, data: created, meta: {} };
      }
    }
  };
}

async function mount(api) {
  const dom = installDom();
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App, { api })); });
  return { dom, root };
}

async function unmount({ dom, root }) {
  await act(async () => { root.unmount(); });
  dom.window.close();
}

test('workstream list renders five deterministic groups and joins open NeedsOwner only in view memory', async () => {
  const source = [
    workstream('ws-running', 'running'), workstream('ws-needs', 'ready'), workstream('ws-waiting', 'waiting'),
    workstream('ws-paused', 'paused'), workstream('ws-completed', 'completed')
  ];
  const f = createServer(source, [{ id: 'need-1', workstreamId: 'ws-needs', status: 'open' }]);
  const view = await mount(f.api);

  assert.deepEqual([...document.querySelectorAll('[data-workstream-group]')].map((node) => node.getAttribute('data-workstream-group')), [
    'Running', 'Needs Owner', 'Waiting', 'Paused', 'Completed'
  ]);
  assert.match(document.body.textContent, /Title ws-running/);
  assert.match(document.body.textContent, /Priority 3/);
  assert.match(document.body.textContent, /Next ws-running/);
  assert.match(document.body.textContent, /Run run-ws-running/);
  assert.match(document.body.textContent, /Needs owner/);
  assert.equal(source[1].status, 'ready');
  assert.equal(Object.hasOwn(source[1], 'needsOwner'), false);
  assert.deepEqual(f.calls.filter((call) => call.type === 'needs_owner.list')[0].payload, { statuses: ['open'] });
  await unmount(view);
});

test('selecting a workstream loads its authoritative detail and exposes its fixed fields', async () => {
  const f = createServer([workstream('ws-1', 'running')]);
  const view = await mount(f.api);

  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });

  for (const value of ['Title ws-1', 'Goal ws-1', 'State ws-1', 'Plan ws-1', 'Next ws-1', 'Blocker ws-1', 'checkpoint-ws-1', 'D:/Echo/ws-1']) {
    assert.match(document.querySelector('[aria-label="Workbench"]').textContent, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(f.calls.filter((call) => call.type === 'workstream.get').length, 1);
  assert.equal(document.querySelector('[data-workstream-id="ws-1"]').getAttribute('aria-current'), 'true');
  await unmount(view);
});

test('create validates fields, sends closed payload with stable identifiers, then reloads and selects the created workstream', async () => {
  const f = createServer([]);
  const view = await mount(f.api);
  const form = document.querySelector('form[data-create-workstream]');

  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.match(form.textContent, /Title is required/);
  assert.equal(f.calls.filter((call) => call.kind === 'command').length, 0);

  const [title, goal] = form.querySelectorAll('input');
  const scenario = form.querySelector('select');
  await act(async () => {
    title.value = 'Created title'; title.dispatchEvent(new window.Event('input', { bubbles: true }));
    goal.value = 'Created goal'; goal.dispatchEvent(new window.Event('input', { bubbles: true }));
    scenario.value = 'learning_research'; scenario.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });

  const command = f.calls.find((call) => call.kind === 'command');
  assert.deepEqual(command.payload, { title: 'Created title', goal: 'Created goal', scenario: 'learning_research' });
  assert.match(command.options.requestId, /^web_workstream_create_/);
  assert.match(command.options.idempotencyKey, /^web_workstream_create_intent_/);
  assert.equal(title.value, '');
  assert.equal(goal.value, '');
  assert.match(document.querySelector('[aria-label="Workbench"]').textContent, /Created title/);
  assert.ok(f.calls.filter((call) => call.type === 'workstream.list').length >= 2);
  assert.equal(f.calls.filter((call) => call.type === 'workstream.get').at(-1).payload.workstreamId, 'ws-created');
  await unmount(view);
});

test('a remounted workbench refetches the selected detail instead of restoring browser or prior React state', async () => {
  const f = createServer([workstream('ws-1', 'running', { currentState: 'First detail' })]);
  const first = await mount(f.api);
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.match(document.querySelector('[aria-label="Workbench"]').textContent, /First detail/);
  await unmount(first);

  f.api.query = async (type, payload = {}) => {
    f.calls.push({ kind: 'query', type, payload });
    if (type === 'workstream.list') return { ok: true, data: { items: [workstream('ws-1', 'running', { currentState: 'Second detail' })] }, meta: {} };
    if (type === 'needs_owner.list') return { ok: true, data: { items: [] }, meta: {} };
    if (type === 'workstream.get') return { ok: true, data: workstream('ws-1', 'running', { currentState: 'Second detail' }), meta: {} };
    throw new Error(`Unexpected query ${type}`);
  };
  const second = await mount(f.api);
  await act(async () => { document.querySelector('[data-workstream-id="ws-1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.match(document.querySelector('[aria-label="Workbench"]').textContent, /Second detail/);
  assert.equal(document.body.textContent.includes('First detail'), false);
  assert.ok(f.calls.filter((call) => call.type === 'workstream.get').length >= 2);
  await unmount(second);
});
