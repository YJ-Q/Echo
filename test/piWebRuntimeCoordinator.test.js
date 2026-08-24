import assert from 'node:assert/strict';
import test from 'node:test';
import { createPiWebRuntimeCoordinator } from '../src/runtime/pi/piWebRuntimeCoordinator.js';

function fixture() {
  const sessions = [];
  const halted = [];
  const runtime = {
    async createSession(options) {
      const session = {
        id: `pi-${sessions.length + 1}`,
        options,
        closes: 0,
        async send({ context, message }) {
          return {
            text: `reply:${message}`,
            toolResults: [{
              toolName: 'action_update', code: 'allowed', auditId: 'audit-1', prompt: 'hidden',
              requestShape: { operation: 'update', fields: ['title'], changeFields: [], prompt: 'also hidden' }
            }],
            context
          };
        },
        async close() { this.closes += 1; }
      };
      sessions.push(session);
      return session;
    },
    async haltSession(id) { halted.push(id); },
    async close() {}
  };
  return { runtime, sessions, halted };
}

test('activate creates one scoped Pi session and replays exactly once without replacing authoritative IDs', async () => {
  const f = fixture();
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: f.runtime, tools: { action_update() {} },
    invocationContextFactory: async ({ run, workstreamId }) => ({ projectId: workstreamId, runId: run.id })
  });
  const run = { id: 'run-1', workstreamId: 'workstream-1' };
  const descriptor = { operation: 'run.start', key: 'start-1', runtimeReference: null, workstreamId: 'forged-workstream' };

  const [first, replay] = await Promise.all([coordinator.activate(run, descriptor), coordinator.activate(run, descriptor)]);

  assert.deepEqual(first, { runtimeSessionId: 'pi-1' });
  assert.deepEqual(replay, first);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].options.tools, undefined);
  assert.deepEqual(await f.sessions[0].options.getInvocationContext({ toolCallId: 'tool-1' }), {
    projectId: 'workstream-1', runId: 'run-1'
  });
  assert.deepEqual(run, { id: 'run-1', workstreamId: 'workstream-1' });
});

test('interact uses only the persisted runtime reference and returns a sanitized reply', async () => {
  const f = fixture();
  const coordinator = createPiWebRuntimeCoordinator({ runtime: f.runtime, tools: {}, invocationContextFactory: async () => ({}) });
  const activated = await coordinator.activate({ id: 'run-1', workstreamId: 'workstream-1' }, { operation: 'run.start', key: 'start-1' });
  const response = await coordinator.interact({
    run: { id: 'run-1', workstreamId: 'workstream-1', runtimeReference: { kind: 'pi', id: activated.runtimeSessionId } },
    context: { digest: 'digest-1', selected: [] }, message: 'continue'
  });

  assert.deepEqual(response, {
    message: 'reply:continue', toolResults: [{
      toolName: 'action_update', code: 'allowed', auditId: 'audit-1',
      requestShape: { operation: 'update', fields: ['title'], changeFields: [] }
    }]
  });
  assert.equal(JSON.stringify(response).includes('hidden'), false);
  assert.deepEqual(f.sessions[0].send ? [] : [], []);
  assert.deepEqual(await coordinator.interact({ run: { id: 'run-1', workstreamId: 'workstream-1', runtimeReference: { kind: 'pi', id: 'other' } }, context: {}, message: 'x' }), {
    error: { code: 'runtime_unavailable', retryable: true }
  });
});

test('session ownership rejects cross-Run, cross-Workstream, and runtime-kind reference hijacking', async () => {
  const f = fixture();
  const coordinator = createPiWebRuntimeCoordinator({ runtime: f.runtime, tools: {}, invocationContextFactory: async () => ({}) });
  const owner = { id: 'run-owner', workstreamId: 'ws-owner' };
  const activated = await coordinator.activate(owner, { operation: 'run.start', key: 'owner-start' });
  const reference = { kind: 'pi', id: activated.runtimeSessionId };

  for (const run of [
    { id: 'run-other', workstreamId: 'ws-owner', runtimeReference: reference },
    { id: 'run-owner', workstreamId: 'ws-other', runtimeReference: reference },
    { id: 'run-owner', workstreamId: 'ws-owner', runtimeReference: { kind: 'other', id: reference.id } }
  ]) {
    assert.deepEqual(await coordinator.interact({ run, context: {}, message: 'steal' }), {
      error: { code: 'runtime_unavailable', retryable: true }
    });
    await assert.rejects(
      () => coordinator.halt(run, { operation: 'run.pause', key: `${run.id}-${run.workstreamId}-${run.runtimeReference.kind}`, runtimeReference: run.runtimeReference }),
      (error) => error.code === 'runtime_unavailable'
    );
  }
  assert.equal(f.sessions[0].closes, 0);
});

test('tool metadata exports only bounded scalar fields from hostile runtime results', async () => {
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: {
      async createSession() {
        return {
          id: 'pi-safe', async close() {},
          async send() {
            return {
              text: 'ok',
              toolResults: [{
                toolName: 'action_update', code: 'allowed', auditId: { token: 'secret' },
                entityId: 'x'.repeat(2_001), entityVersion: '3', confirmationRequired: 'yes',
                requestShape: { operation: { prompt: 'secret' }, fields: ['ok', { credential: 'secret' }], changeFields: 'bad' }
              }]
            };
          }
        };
      }
    }, tools: {}, invocationContextFactory: async () => ({})
  });
  const activated = await coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-1' });

  const result = await coordinator.interact({ run: { id: 'run-1', workstreamId: 'ws-1', runtimeReference: { kind: 'pi', id: activated.runtimeSessionId } }, context: {}, message: 'go' });

  assert.deepEqual(result, { message: 'ok', toolResults: [{ toolName: 'action_update', code: 'allowed', requestShape: { fields: ['ok'] } }] });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('concurrent turns for one session are serialized before Pi prompt execution', async () => {
  const starts = [];
  const releases = [];
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: {
      async createSession() {
        return {
          id: 'pi-serial', async close() {},
          async send({ message }) {
            starts.push(message);
            await new Promise((resolve) => { releases.push(resolve); });
            return { text: message, toolResults: [] };
          }
        };
      }
    }, tools: {}, invocationContextFactory: async () => ({})
  });
  const activated = await coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-serial' });
  const run = { id: 'run-1', workstreamId: 'ws-1', runtimeReference: { kind: 'pi', id: activated.runtimeSessionId } };
  const first = coordinator.interact({ run, context: {}, message: 'first' });
  const second = coordinator.interact({ run, context: {}, message: 'second' });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['first']);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['first', 'second']);
  releases.shift()();
  assert.deepEqual(await Promise.all([first, second]), [
    { message: 'first', toolResults: [] }, { message: 'second', toolResults: [] }
  ]);
});

test('a queued turn is cancelled after halt instead of sending after the Run is paused', async () => {
  const sends = [];
  let releaseFirst;
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: {
      async createSession() {
        return {
          id: 'pi-halt-race', async close() {},
          async send({ message }) {
            sends.push(message);
            if (message === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
            return { text: message, toolResults: [] };
          }
        };
      }
    }, tools: {}, invocationContextFactory: async () => ({})
  });
  const activated = await coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-halt-race' });
  const run = { id: 'run-1', workstreamId: 'ws-1', runtimeReference: { kind: 'pi', id: activated.runtimeSessionId } };
  const first = coordinator.interact({ run, context: {}, message: 'first' });
  const second = coordinator.interact({ run, context: {}, message: 'second' });

  await new Promise((resolve) => setImmediate(resolve));
  await coordinator.halt(run, { operation: 'run.pause', key: 'pause-halt-race', runtimeReference: run.runtimeReference });
  releaseFirst();

  assert.deepEqual(await first, { message: 'first', toolResults: [] });
  assert.deepEqual(await second, { error: { code: 'runtime_unavailable', retryable: true } });
  assert.deepEqual(sends, ['first']);
});

test('halt, reconciliation, and close do not leave duplicate or ghost Pi sessions', async () => {
  const f = fixture();
  const coordinator = createPiWebRuntimeCoordinator({ runtime: f.runtime, tools: {}, invocationContextFactory: async () => ({}) });
  const active = await coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-1' });
  const pauses = [];

  await coordinator.reconcile([{ id: 'run-old', workstreamId: 'ws-old', runtimeReference: { kind: 'pi', id: 'persisted-old' } }], async (run) => {
    pauses.push(run.id);
    await coordinator.halt(run, { operation: 'run.pause', key: 'reconcile-run-old', runtimeReference: run.runtimeReference });
  });
  await Promise.all([
    coordinator.halt({ id: 'run-1', workstreamId: 'ws-1', runtimeReference: { kind: 'pi', id: active.runtimeSessionId } }, { operation: 'run.pause', key: 'pause-1', runtimeReference: { kind: 'pi', id: active.runtimeSessionId } }),
    coordinator.halt({ id: 'run-1', workstreamId: 'ws-1', runtimeReference: { kind: 'pi', id: active.runtimeSessionId } }, { operation: 'run.pause', key: 'pause-1', runtimeReference: { kind: 'pi', id: active.runtimeSessionId } })
  ]);
  await coordinator.close();
  await coordinator.close();

  assert.deepEqual(pauses, ['run-old']);
  assert.deepEqual(f.halted, ['persisted-old']);
  assert.equal(f.sessions[0].closes, 1);
});

test('activation waits for governed restart reconciliation before creating a Pi session', async () => {
  const f = fixture();
  const coordinator = createPiWebRuntimeCoordinator({ runtime: f.runtime, tools: {}, invocationContextFactory: async () => ({}) });
  let releasePause;
  const reconciling = coordinator.reconcile(
    [{ id: 'run-old', runtimeReference: { kind: 'pi', id: 'persisted-old' } }],
    async () => new Promise((resolve) => { releasePause = resolve; })
  );
  const activating = coordinator.activate({ id: 'run-new', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-new' });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.sessions.length, 0);
  releasePause();
  await Promise.all([reconciling, activating]);
  assert.equal(f.sessions.length, 1);
});

test('close disposes a session that finishes opening during shutdown', async () => {
  let releaseSession;
  const session = { id: 'late-session', async send() {}, closes: 0, async close() { this.closes += 1; } };
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: { async createSession() { return new Promise((resolve) => { releaseSession = () => resolve(session); }); }, async close() {} },
    tools: {}, invocationContextFactory: async () => ({})
  });
  const activating = coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-1' });

  await new Promise((resolve) => setImmediate(resolve));
  await coordinator.close();
  releaseSession();
  await assert.rejects(activating, (error) => error.code === 'runtime_unavailable');
  assert.equal(session.closes, 1);
});

test('runtime failures have the stable sanitized runtime_unavailable result', async () => {
  const coordinator = createPiWebRuntimeCoordinator({
    runtime: { async createSession() { throw new Error('token=secret stack=private'); } }, tools: {}, invocationContextFactory: async () => ({})
  });

  await assert.rejects(
    () => coordinator.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'start-1' }),
    (error) => error.code === 'runtime_unavailable' && !String(error.message).includes('secret')
  );
});

test('runtime and close failures reject with a stable code-only application error', async () => {
  const unavailable = createPiWebRuntimeCoordinator({
    runtime: { async createSession() { throw { code: 'runtime_unavailable', message: 'token=secret', stack: 'private' }; } },
    tools: {}, invocationContextFactory: async () => ({})
  });
  await assert.rejects(
    () => unavailable.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'failing-start' }),
    (error) => JSON.stringify(error) === '{"code":"runtime_unavailable"}' && !Object.hasOwn(error, 'message') && !Object.hasOwn(error, 'stack')
  );
  const closing = createPiWebRuntimeCoordinator({
    runtime: { async createSession() { return { id: 'pi-1', async send() {}, async close() {} }; }, async close() { throw new Error('token=secret'); } },
    tools: {}, invocationContextFactory: async () => ({})
  });
  await closing.activate({ id: 'run-1', workstreamId: 'ws-1' }, { operation: 'run.start', key: 'closing-start' });
  await assert.rejects(
    () => closing.close(),
    (error) => JSON.stringify(error) === '{"code":"runtime_unavailable"}' && !Object.hasOwn(error, 'message') && !Object.hasOwn(error, 'stack')
  );
});
