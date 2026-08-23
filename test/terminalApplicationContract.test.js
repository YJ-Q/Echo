import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalPilotController } from '../src/pilot/terminalPilotController.js';

function contractOnlyCoreFixture({ workstreamPages, workstreamGetFailure, failFirstRunControl } = {}) {
  const calls = [];
  const hostBindings = [];
  const workstream = {
    id: 'workstream-1', title: '简历投递与记录维护', goal: '持续完成简历投递并维护投递记录',
    status: 'running', version: 1
  };
  const pages = workstreamPages?.(workstream) ?? [[workstream]];
  let run = null;
  let runControlFailed = false;
  const core = {
    calls,
    hostBindings,
    v1Tools: {},
    continuity: {
      async snapshot() { return { project: workstream, activeTask: null, decisions: [], memories: [], actions: [] }; },
      async plan() { return { projectId: workstream.id, selected: [], excluded: [], digest: 'digest-1' }; }
    },
    bindHostContext(context) { hostBindings.push(context); return { ...context, hostBound: true }; },
    createApplicationContract({ runtimeControl }) {
      return {
        async query(request, context) {
          assert.equal(request.requestId, context.requestId);
          calls.push({ type: request.type, request, context });
          if (request.type === 'workstream.get') {
            if (request.payload.workstreamId === workstream.id && workstreamGetFailure) {
              return { ok: false, error: { code: workstreamGetFailure }, meta: { requestId: request.requestId } };
            }
            return request.payload.workstreamId === workstream.id
              ? { ok: true, data: workstream, meta: { requestId: request.requestId } }
              : { ok: false, error: { code: 'not_found' }, meta: { requestId: request.requestId } };
          }
          if (request.type === 'workstream.list') {
            const index = request.payload.cursor ? Number(request.payload.cursor) : 0;
            return {
              ok: true,
              data: { items: pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null },
              meta: { requestId: request.requestId }
            };
          }
          if (request.type === 'run.list') return { ok: true, data: { items: run ? [run] : [], nextCursor: null }, meta: { requestId: request.requestId } };
          if (request.type === 'run.get') return { ok: true, data: run, meta: { requestId: request.requestId } };
          throw new Error(`unexpected_query:${request.type}`);
        },
        async execute(command, context) {
          assert.equal(command.requestId, context.requestId);
          calls.push({ type: command.type, command, context });
          if (command.type.startsWith('run.')) assert.equal(context.hostBound, true);
          if (command.type === 'workstream.create') {
            return { ok: true, data: workstream, meta: { requestId: command.requestId } };
          } else if (command.type === 'run.create') {
            run = { id: 'run-1', workstreamId: workstream.id, workerKind: 'pi', status: 'queued', version: 1, runtimeReference: null };
          } else if (command.type === 'run.start' || command.type === 'run.resume') {
            const active = await runtimeControl.activate(run, {
              operation: command.type, key: command.idempotencyKey, runtimeReference: run.runtimeReference
            });
            run = { ...run, status: 'running', version: run.version + 1, runtimeReference: { kind: 'pi', id: active.runtimeSessionId } };
          } else if (command.type === 'run.pause') {
            await runtimeControl.halt(run, {
              operation: command.type, key: command.idempotencyKey, runtimeReference: run.runtimeReference
            });
            if (failFirstRunControl === command.type && !runControlFailed) {
              runControlFailed = true;
              return { ok: false, error: { code: 'storage_failure', retryable: true }, meta: { requestId: command.requestId } };
            }
            run = { ...run, status: 'paused', version: run.version + 1 };
          } else if (command.type === 'run.stop') {
            await runtimeControl.halt(run, {
              operation: command.type, key: command.idempotencyKey, runtimeReference: run.runtimeReference
            });
            if (failFirstRunControl === command.type && !runControlFailed) {
              runControlFailed = true;
              return { ok: false, error: { code: 'storage_failure', retryable: true }, meta: { requestId: command.requestId } };
            }
            run = { ...run, status: 'cancelled', version: run.version + 1 };
          } else if (command.type === 'checkpoint.create') {
            return { ok: true, data: { id: 'checkpoint-1' }, meta: { requestId: command.requestId } };
          } else {
            throw new Error(`unexpected_command:${command.type}`);
          }
          return { ok: true, data: run, meta: { requestId: command.requestId } };
        }
      };
    }
  };
  return core;
}

function dependencies(core, { savedId = 'missing-workstream' } = {}) {
  let sessionNumber = 0;
  return {
    core,
    runtime: {
      async createSession() {
        return { id: `session-${++sessionNumber}`, async send() { return { text: 'ok' }; }, async close() {} };
      }
    },
    registry: { async load() { return savedId; }, async save() {} },
    clock: () => '2026-08-24T00:00:00.000Z',
    idFactory: (() => { let id = 0; return (prefix) => `${prefix}-${++id}`; })()
  };
}

test('terminal lifecycle uses only Application Contract for persistent Workstream Run and checkpoint operations', async () => {
  const core = contractOnlyCoreFixture();
  const controller = createTerminalPilotController(dependencies(core));
  await controller.start();
  await controller.handle('/pause');
  await controller.handle('/resume');
  await controller.handle('/checkpoint');
  await controller.handle('/stop');
  assert.deepEqual(core.calls.map((call) => call.type), [
    'workstream.get', 'workstream.list', 'run.list', 'run.create', 'run.start',
    'run.pause', 'run.resume', 'workstream.get', 'checkpoint.create', 'run.stop'
  ]);
  const commands = core.calls.filter((call) => call.command);
  assert.equal(new Set(commands.map((call) => call.command.idempotencyKey)).size, commands.length);
  assert.equal(new Set(core.calls.map((call) => (call.request ?? call.command).requestId)).size, core.calls.length);
  assert.equal(core.calls.every((call) => (call.request ?? call.command).requestId === call.context.requestId), true);
  assert.equal(new Set(core.calls.map((call) => JSON.stringify(call.context.actor))).size, 1);
  assert.equal(new Set(core.calls.map((call) => JSON.stringify(call.context.surface))).size, 1);
  assert.equal(new Set(core.calls.map((call) => call.context.correlationId)).size, 1);
  assert.deepEqual(core.calls.map((call) => call.context.capabilities), [
    ['workstream:read'], ['workstream:read'], ['run:read'], ['run:control'], ['run:control'],
    ['run:control'], ['run:control'], ['workstream:read'], ['checkpoint:write'], ['run:control']
  ]);
  assert.deepEqual(core.hostBindings.map((context) => context.requestId), core.calls
    .filter((call) => call.type.startsWith('run.') && call.command)
    .map((call) => call.command.requestId));
});

test('terminal discovers the pilot Workstream across Application Contract pages', async () => {
  const core = contractOnlyCoreFixture({
    workstreamPages: (pilot) => [
      [{ ...pilot, id: 'unrelated', title: '其他工作流', goal: '其他目标' }],
      [{ ...pilot, goal: '已经通过 update_project 更新的目标' }]
    ]
  });
  const controller = createTerminalPilotController(dependencies(core, { savedId: null }));
  const started = await controller.start();
  assert.equal(started.projectId, 'workstream-1');
  assert.deepEqual(core.calls.slice(0, 3).map((call) => call.type), [
    'workstream.list', 'workstream.list', 'run.list'
  ]);
  assert.equal(core.calls.some((call) => call.type === 'workstream.create'), false);
});

test('/checkpoint returns a stable failure without writing when Workstream refresh fails', async () => {
  const core = contractOnlyCoreFixture({ workstreamGetFailure: 'storage_failure' });
  const controller = createTerminalPilotController(dependencies(core));
  await controller.start();
  const result = await controller.handle('/checkpoint');
  assert.deepEqual({ kind: result.kind, code: result.code, text: result.text }, {
    kind: 'error', code: 'storage_failure', text: 'Checkpoint 保存失败，请重试。'
  });
  assert.equal(core.calls.some((call) => call.type === 'checkpoint.create'), false);
});

test('terminal retries a failed Run command with the same business idempotency key', async () => {
  const core = contractOnlyCoreFixture({ failFirstRunControl: 'run.pause' });
  const controller = createTerminalPilotController(dependencies(core));
  await controller.start();
  const first = await controller.handle('/pause');
  const retry = await controller.handle('/pause');
  assert.deepEqual({ kind: first.kind, code: first.code }, { kind: 'error', code: 'storage_failure' });
  assert.equal(retry.runStatus, 'paused');
  const pauseCommands = core.calls.filter((call) => call.type === 'run.pause').map((call) => call.command);
  assert.equal(pauseCommands.length, 2);
  assert.equal(pauseCommands[0].idempotencyKey, pauseCommands[1].idempotencyKey);
  assert.notEqual(pauseCommands[0].requestId, pauseCommands[1].requestId);
});
