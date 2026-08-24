import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionService } from '../src/application/interactionService.js';
import { createWebGateway } from '../src/http/webGateway.js';

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

test('submit preserves safe Gateway failure envelopes instead of reclassifying them as not_found', async () => {
  const service = createInteractionService({
    webGateway: {
      async internalQuery() {
        return { ok: false, error: { code: 'version_conflict', retryable: false, details: { currentVersion: 7, stack: 'private' } } };
      },
      async internalEvents() { throw new Error('unused'); }
    },
    continuity: { async snapshot() {}, async plan() {} }, runtimeCoordinator: { async interact() {} }, clock: () => 'now'
  });

  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'x' }), {
    error: { code: 'version_conflict', retryable: false, details: { currentVersion: 7 } }
  });
});

test('Interaction receives a trusted runtime reference while browser Gateway reads remain sanitized', async () => {
  const workstream = { id: 'ws-1', title: 'Workstream', goal: 'Goal', status: 'running', version: 1 };
  const run = { id: 'run-1', workstreamId: 'ws-1', workerKind: 'pi', runtimeReference: { kind: 'pi', id: 'pi-1' }, status: 'running', version: 1 };
  const core = {
    bindHostContext(context) { return context; },
    createApplicationContract() {
      return {
        async query(request, context) {
          const data = request.type === 'workstream.get' ? workstream : run;
          return { ok: true, data, meta: { contractVersion: '1.0', requestId: request.requestId, correlationId: context.correlationId } };
        },
        async events(request, context) {
          return { ok: true, data: { items: [], nextCursor: 0, hasMore: false }, meta: { contractVersion: '1.0', requestId: request.requestId, correlationId: context.correlationId } };
        },
        async execute() { throw new Error('unused'); }
      };
    }
  };
  let runtimeRun;
  const gateway = createWebGateway({ core, instanceId: 'web-1', idFactory: (prefix) => `${prefix}-1` });
  const browserRead = await gateway.query({ type: 'run.get', requestId: 'browser-run', payload: { runId: 'run-1' } });
  assert.equal(browserRead.data.runtimeReference, undefined);
  const service = createInteractionService({
    webGateway: gateway,
    continuity: { async snapshot() { return { actions: [] }; }, async plan() { return { selected: [], excluded: [] }; } },
    runtimeCoordinator: { async interact({ run: current }) { runtimeRun = current; return { message: 'ok', toolResults: [] }; } },
    clock: () => 'now'
  });

  const result = await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'continue' });

  assert.equal(result.message, 'ok');
  assert.deepEqual(runtimeRun.runtimeReference, { kind: 'pi', id: 'pi-1' });
});

test('submit rejects a post-turn Run that no longer belongs to the requested Workstream', async () => {
  let runReads = 0;
  const service = createInteractionService({
    webGateway: {
      async internalQuery(type) {
        if (type === 'workstream.get') return envelope({ id: 'ws-1', status: 'running', version: 1 });
        runReads += 1;
        return envelope({ id: 'run-1', workstreamId: runReads === 1 ? 'ws-1' : 'ws-other', status: 'running', runtimeReference: { kind: 'pi', id: 'pi-1' }, version: 1 });
      },
      async internalEvents() { return envelope({ items: [], nextCursor: 0, hasMore: false }); }
    },
    continuity: { async snapshot() { return { actions: [] }; }, async plan() { return { selected: [], excluded: [] }; } },
    runtimeCoordinator: { async interact() { return { message: 'must not escape', toolResults: [] }; } }, clock: () => 'now'
  });

  assert.deepEqual(await service.submit({ workstreamId: 'ws-1', runId: 'run-1', message: 'continue' }), {
    error: { code: 'cross_workstream_reference', retryable: false }
  });
});
