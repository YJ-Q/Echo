import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';
import { detectAgentSources, readAgentSourceRegistry, writeAgentSourceRegistry } from '../src/agents/sourceRegistry.js';
import { MarginApp } from '../web/src/margin/MarginApp.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(app) {
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const session = (id) => ({ id, nativeSessionId: id, canonicalId: `codex:source:${id}`, sourceId: 'source', agentType: 'codex', label: id, updatedAt: '2026-09-08T00:00:00.000Z' });

test('S8.5B manual disabled custom source survives detect and corrupt registries are never replaced', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s85-registry-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const env = { USERPROFILE: profile, HOME: profile };
  const home = path.join(profile, '.codex'); fs.mkdirSync(home, { recursive: true });
  const manual = { version: 1, sources: [{ type: 'codex', path: home, name: 'My disabled Codex', origin: 'manual', enabled: false }] };
  writeAgentSourceRegistry(manual, { env });
  const detected = detectAgentSources(readAgentSourceRegistry({ env }), { env }).registry.sources[0];
  assert.deepEqual([detected.origin, detected.enabled, detected.name, detected.path], ['manual', false, 'My disabled Codex', home]);

  const registryFile = path.join(profile, '.margin', 'agent-sources.json');
  fs.writeFileSync(registryFile, '{ definitely not JSON');
  const broken = readAgentSourceRegistry({ env });
  assert.equal(broken.ok, false);
  assert.equal(broken.error.code, 'registry_unreadable');
  assert.equal(fs.readFileSync(registryFile, 'utf8'), '{ definitely not JSON');
});

test('S8.5B snapshot read failure keeps LKG client-side and retries the same revision after recovery', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://margin.test/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const state = { revision: 'R0', failed: false, calls: 0, active: 0, maxActive: 0 };
  const api = {
    listSessions: async () => {
      state.calls += 1; state.active += 1; state.maxActive = Math.max(state.maxActive, state.active);
      await wait(8); state.active -= 1;
      return state.failed ? { ok: false, error: { message: 'temporary read failure' } } : { ok: true, data: { revision: state.revision, sessions: [session(state.revision === 'R0' ? 'old' : 'new')] } };
    },
    getSessionsRevision: async () => ({ ok: true, data: { revision: state.revision } }),
    listAgentSources: async () => ({ ok: true, data: { sources: [] } }),
    getResourceStatus: async () => ({ agents: [] }),
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await act(async () => { root.render(React.createElement(MarginApp, { api, pollMs: 15, refreshGapMs: 0 })); });
  await act(async () => { await wait(35); });
  assert.equal(state.calls, 1, 'initial LKG snapshot completed before the failing refresh');
  await act(async () => { state.revision = 'R1'; state.failed = true; document.querySelector('.margin-usage-toggle').click(); await wait(70); });
  assert.equal(document.querySelector('.margin-row-title')?.textContent, 'old', 'failed R1 never clears the LKG row');
  state.failed = false;
  await act(async () => { await wait(80); });
  assert.equal(document.querySelector('.margin-row-title')?.textContent, 'new', 'the unchanged observed R1 is retried and committed after recovery');
  assert.equal(state.maxActive, 1, 'all refresh entry points share one authoritative request');
});

test('S8.5B rejects a snapshot whose source revision changed during its read', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s85-mid-read-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = { id: 'source', sourceId: 'source', type: 'codex', path: home, origin: 'manual', enabled: true };
  let revision = 'R0'; let first = true;
  const adapter = {
    getSessionRevision: () => revision,
    readSessionSnapshots: async () => {
      if (first) { first = false; revision = 'R1'; return { ok: true, snapshots: [session('old')] }; }
      return { ok: true, snapshots: [session('new')] };
    },
  };
  const app = createHandoffHttpAdapter({ rootDir: home, readRegistry: () => ({ ok: true, version: 1, sources: [source] }), writeRegistry: (value) => value, adapterResolver: () => adapter });
  const { server, origin } = await listen(app); t.after(() => server.close());
  const raced = await fetch(`${origin}/api/sessions`);
  assert.equal(raced.status, 503);
  assert.equal((await raced.json()).error.code, 'snapshot_changed_during_read');
  const recovered = await (await fetch(`${origin}/api/sessions`)).json();
  assert.deepEqual(recovered.data.sessions.map((item) => item.id), ['new']);
  const polled = await (await fetch(`${origin}/api/sessions/revision`)).json();
  assert.equal(recovered.data.revision, polled.data.revision, 'the committed aggregate revision describes this recovered snapshot');
});

test('S8.5B isolates an unavailable Claude archive source while preserving Codex and Pi snapshots', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s85-source-isolation-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sources = ['codex', 'claude', 'pi'].map((type) => ({ id: `${type}-source`, sourceId: `${type}-source`, type, path: home, origin: 'manual', enabled: true }));
  const adapterResolver = (type) => ({
    getSessionRevision: () => {
      if (type === 'claude') throw Object.assign(new Error('Claude archive state is not readable'), { code: 'source_read_failed' });
      return `${type}-revision`;
    },
    readSessionSnapshots: async () => type === 'claude'
      ? { ok: false, error: { code: 'source_read_failed', message: 'Claude archive state is not readable' } }
      : { ok: true, snapshots: [{ ...session(`${type}-session`), agentType: type, sourceId: `${type}-source`, canonicalId: `${type}:${type}-source:${type}-session` }] },
  });
  const app = createHandoffHttpAdapter({ rootDir: home, readRegistry: () => ({ ok: true, version: 1, sources }), writeRegistry: (value) => value, adapterResolver });
  const { server, origin } = await listen(app); t.after(() => server.close());
  const response = await fetch(`${origin}/api/sessions`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.sessions.map((item) => item.agentType).sort(), ['codex', 'pi']);
  assert.doesNotMatch(JSON.stringify(body), /claude-session/);
});

test('S8.5B retains Claude LKG on archive failure and reconciles it after recovery', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-s85-claude-lkg-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sources = ['codex', 'claude', 'pi'].map((type) => ({ id: `${type}-source`, sourceId: `${type}-source`, type, path: home, origin: 'manual', enabled: true }));
  const state = { claudeAvailable: true, claudeRevision: 'claude-r1' };
  const adapterResolver = (type) => ({
    getSessionRevision: () => {
      if (type === 'claude' && !state.claudeAvailable) throw new Error('Claude archive state is not readable');
      return type === 'claude' ? state.claudeRevision : `${type}-r1`;
    },
    readSessionSnapshots: async () => {
      if (type === 'claude' && !state.claudeAvailable) throw new Error('Claude archive state is not readable');
      const id = type === 'claude' ? state.claudeRevision : `${type}-r1`;
      return { ok: true, snapshots: [{ ...session(id), agentType: type, sourceId: `${type}-source`, canonicalId: `${type}:${type}-source:${id}` }] };
    },
  });
  const app = createHandoffHttpAdapter({ rootDir: home, readRegistry: () => ({ ok: true, version: 1, sources }), writeRegistry: (value) => value, adapterResolver });
  const { server, origin } = await listen(app); t.after(() => server.close());
  const listed = async () => (await (await fetch(`${origin}/api/sessions`)).json()).data.sessions;
  assert.deepEqual((await listed()).map((item) => item.id).sort(), ['claude-r1', 'codex-r1', 'pi-r1']);
  state.claudeAvailable = false;
  assert.deepEqual((await listed()).map((item) => item.id).sort(), ['claude-r1', 'codex-r1', 'pi-r1'], 'a failed Claude read returns its trusted LKG, not fabricated archive visibility');
  state.claudeAvailable = true;
  state.claudeRevision = 'claude-r2';
  assert.deepEqual((await listed()).map((item) => item.id).sort(), ['claude-r2', 'codex-r1', 'pi-r1'], 'a recovered Claude source replaces its stale LKG');
});
