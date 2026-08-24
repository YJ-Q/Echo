import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionService } from '../src/application/interactionService.js';

function envelope(data) { return { ok: true, data }; }

function gatewayFixture() {
  const calls = [];
  let workstream = { id: 'ws-1', version: 2, title: 'Web workstream', status: 'running' };
  let run = { id: 'run-1', workstreamId: 'ws-1', version: 3, status: 'running', runtimeReference: { kind: 'pi', id: 'pi-1' } };
  return {
    calls,
    setRun(value) { run = value; },
    gateway: {
      async internalQuery(type, payload) {
        calls.push({ kind: 'query', type, payload });
        if (type === 'workstream.get') return envelope(workstream);
        if (type === 'run.get') return envelope(run);
        throw new Error(`unexpected query ${type}`);
      },
      async internalEvents(type, payload) {
        calls.push({ kind: 'events', type, payload });
        return envelope({ items: [{ eventType: 'run.progressed' }], nextCursor: 42 });
      }
    }
  };
}

test('submit reads authoritative state through the Web Gateway, bounds continuity, and returns only the public turn result', async () => {
  const f = gatewayFixture();
  let runtimeCall;
  const service = createInteractionService({
    webGateway: f.gateway,
    continuity: {
      async snapshot(input) { return { project: { id: input.projectId, goal: 'goal' }, activeTask: null, decisions: [], memories: [], recentDialogue: [], actions: Array.from({ length: 7 }, (_, index) => ({ id: `a-${index}`, version: 1, title: `action ${index}`, status: 'pending' })) }; },
      async plan() { return { selected: Array.from({ length: 10 }, (_, index) => ({ entityId: `base-${index}`, sourceType: 'memory' })), excluded: [] }; }
    },
    runtimeCoordinator: {
      async interact(value) { runtimeCall = value; return { message: 'done', toolResults: [{ toolName: 'action_update', code: 'allowed', prompt: 'private' }], runtime: {} }; }
    },
    clock: () => '2026-08-24T00:00:00.000Z'
  });

  const result = await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: '  continue the work  ' });

  assert.deepEqual(Object.keys(result).sort(), ['events', 'message', 'run', 'toolResults', 'workstream']);
  assert.equal(result.message, 'done');
  assert.equal(runtimeCall.message, 'continue the work');
  assert.equal(runtimeCall.context.selected.length, 12);
  assert.equal(runtimeCall.context.selected.filter((entry) => entry.reason === 'open_action').length, 2);
  assert.equal(typeof runtimeCall.context.digest, 'string');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(f.calls.map((call) => [call.kind, call.type]), [
    ['query', 'workstream.get'], ['query', 'run.get'], ['events', 'event.list'],
    ['query', 'workstream.get'], ['query', 'run.get'], ['events', 'event.list']
  ]);
  assert.deepEqual(f.calls.filter((call) => call.kind === 'events').map((call) => call.payload.afterCursor), [0, 42]);
});

test('submit rejects invalid messages and missing, mismatched, or non-running Runs with stable errors before invoking runtime', async () => {
  const f = gatewayFixture();
  let runtimeCalls = 0;
  const service = createInteractionService({
    webGateway: f.gateway,
    continuity: { async snapshot() {}, async plan() {} },
    runtimeCoordinator: { async interact() { runtimeCalls += 1; } }, clock: () => 'now'
  });
  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x'.repeat(2001) }), { error: { code: 'invalid_request', retryable: false } });
  f.setRun({ id: 'run-1', workstreamId: 'other', status: 'running' });
  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x' }), { error: { code: 'cross_workstream_reference', retryable: false } });
  f.setRun({ id: 'run-1', workstreamId: 'ws-1', status: 'paused' });
  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x' }), { error: { code: 'run_not_running', retryable: false } });
  assert.equal(runtimeCalls, 0);
});

test('submit forwards a stable runtime failure without assistant persistence or direct state access', async () => {
  const f = gatewayFixture();
  const service = createInteractionService({
    webGateway: f.gateway,
    continuity: { async snapshot() { return { project: { id: 'ws-1', goal: 'g' }, decisions: [], memories: [], recentDialogue: [], actions: [] }; }, async plan() { return { selected: [], excluded: [] }; } },
    runtimeCoordinator: { async interact() { return { error: { code: 'runtime_unavailable', retryable: true }, prompt: 'secret' }; } },
    clock: () => 'now'
  });

  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x' }), {
    error: { code: 'runtime_unavailable', retryable: true }
  });
});

test('submit reports a Gateway read failure as a stable storage failure', async () => {
  const service = createInteractionService({
    webGateway: {
      async internalQuery() { throw new Error('database path and stack must not escape'); },
      async internalEvents() { throw new Error('unexpected'); }
    },
    continuity: { async snapshot() {}, async plan() {} },
    runtimeCoordinator: { async interact() {} },
    clock: () => 'now'
  });

  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x' }), {
    error: { code: 'storage_failure', retryable: true }
  });
});
