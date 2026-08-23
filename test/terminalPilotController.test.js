import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalPilotController } from '../src/pilot/terminalPilotController.js';

function fixture({ discoverExisting = false, activeTask = true, persistentRun = false, existingRunStatus = null } = {}) {
  const calls = { created: 0, taskCreated: 0, sessions: [], saved: null, queries: [], haltedSessions: [] };
  const project = { id: 'project-1', version: 1, title: '简历投递与记录维护', goal: '持续完成简历投递并维护投递记录', phase: 'pilot', status: 'running' };
  const snapshot = { project, activeTask: activeTask ? { id: 'task-1', version: 1, title: '推进投递', current_step: '记录下一次投递' } : null, decisions: [], memories: [], recentDialogue: [], actions: [{ id: 'action-1', version: 2, title: '投递示例公司', status: 'pending', source_session_id: 'session-1' }] };
  const core = {
    bindHostContext(context) { return { ...context, hostBound: true }; },
    continuity: {
      async snapshot(input) { calls.queries.push(input); return snapshot; },
      async plan() { return { projectId: project.id, selected: [], excluded: [], digest: 'digest-1' }; }
    },
    v1Tools: { memory_search() {}, memory_propose() {}, state_update() {}, action_update() {} },
    async confirmMemory(input, context) { calls.confirmed = { input, context }; return { memory: { id: input.memoryId, version: 3 }, auditId: 'audit-confirm' }; }
  };
  let run = existingRunStatus ? {
    id: 'run-1', workstreamId: project.id, workerKind: 'pi', status: existingRunStatus, version: 2,
    runtimeReference: { kind: 'pi', id: 'persisted-session' }, checkpoint: null
  } : null;
  calls.currentRun = () => run;
  core.createApplicationContract = ({ runtimeControl }) => {
    calls.runtimeControl = runtimeControl;
    return ({
    async query(request) {
      if (request.type === 'workstream.get') return { ok: true, data: request.payload.workstreamId === project.id ? project : null };
      if (request.type === 'workstream.list') return { ok: true, data: { items: discoverExisting ? [project] : [], nextCursor: null } };
      if (request.type === 'run.list') return { ok: true, data: { items: persistentRun && run ? [run] : [], nextCursor: null } };
      if (request.type === 'run.get') return { ok: true, data: run };
      throw new Error(`unexpected_query:${request.type}`);
    },
    async execute(command, context) {
      if (command.type === 'workstream.create') {
        calls.created += 1;
        return { ok: true, data: project };
      }
      if (command.type === 'run.create') {
        assert.equal(context.hostBound, true);
        run = { id: 'run-1', workstreamId: project.id, workerKind: 'pi', status: 'queued', version: 1, runtimeReference: null, checkpoint: null };
      } else if (command.type === 'run.start' || command.type === 'run.resume') {
        assert.equal(context.hostBound, true);
        const active = await runtimeControl.activate(run);
        run = { ...run, status: 'running', version: run.version + 1, runtimeReference: { kind: 'pi', id: active.runtimeSessionId } };
      } else if (command.type === 'run.pause') {
        assert.equal(context.hostBound, true);
        await runtimeControl.halt(run);
        run = { ...run, status: 'paused', version: run.version + 1, checkpoint: { id: 'checkpoint-pause' } };
      } else if (command.type === 'run.stop') {
        assert.equal(context.hostBound, true);
        await runtimeControl.halt(run);
        run = { ...run, status: 'cancelled', version: run.version + 1, checkpoint: { id: 'checkpoint-stop' } };
      } else if (command.type === 'checkpoint.create') {
        calls.checkpointInput = command.payload;
        return { ok: true, data: { id: 'checkpoint-manual' } };
      } else {
        throw new Error(`unexpected_command:${command.type}`);
      }
      return { ok: true, data: run };
    }
    });
  };
  let next = 0;
  const runtime = {
    async haltSession(id) { calls.haltedSessions.push(id); return { halted: true }; },
    async createSession() {
      const id = `session-${++next}`;
      const session = { id, closed: false, contexts: [], async send(input) { this.contexts.push(input.context); return { text: `回复-${id}`, resultCodes: ['allowed'] }; }, async close() { this.closed = true; } };
      calls.sessions.push(session);
      return session;
    }
  };
  const registry = { async load() { return null; }, async save(id) { calls.saved = id; } };
  return { core, runtime, registry, calls };
}

test('controller creates the pilot project and handles messages without leaking text into trace', async () => {
  const f = fixture();
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  const started = await controller.start();
  assert.equal(started.projectId, 'project-1');
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.saved, 'project-1');
  const result = await controller.handle('今天投递了示例公司');
  assert.equal(result.text, '回复-session-1');
  assert.match(result.trace.contextDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result.trace), /示例公司/);
  assert.deepEqual(f.calls.sessions[0].contexts[0].writeRouting.routes, ['state']);
});

test('controller grants the exact Core permission for proposing memory', async () => {
  const f = fixture();
  let invocationContext;
  f.runtime.createSession = async (options) => {
    invocationContext = await options.getInvocationContext({ toolCallId: 'call-1' });
    return { id: 'session-permissions', async send() { return { text: 'ok' }; }, async close() {} };
  };
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  assert.equal(invocationContext.permissions.memoryPropose, true);
  assert.equal('memoryWrite' in invocationContext.permissions, false);
});

test('terminal Runtime adapter makes repeated and already-halted persisted references successful no-ops', async () => {
  const f = fixture({ persistentRun: true, existingRunStatus: 'paused' });
  const controller = createTerminalPilotController({
    core: f.core, runtime: f.runtime, registry: f.registry,
    clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1`
  });
  await controller.start();
  const persistedRun = f.calls.currentRun();
  const descriptor = {
    operation: 'run.stop', key: 'stable-stop-key', runtimeReference: persistedRun.runtimeReference
  };
  await f.calls.runtimeControl.halt(persistedRun, descriptor);
  await f.calls.runtimeControl.halt(persistedRun, descriptor);
  await f.calls.runtimeControl.halt(persistedRun, { ...descriptor, key: 'later-stop-key' });
  assert.deepEqual(f.calls.haltedSessions, ['persisted-session']);
});

test('controller makes partial write failures explicit even when assistant prose is optimistic', async () => {
  const f = fixture();
  f.runtime.createSession = async () => ({
    id: 'session-partial',
    async send() {
      return {
        text: '状态已经全部更新。', resultCodes: ['allowed', 'invalid_request'],
        toolResults: [
          { toolName: 'action_update', code: 'allowed', auditId: 'audit-ok' },
          { toolName: 'state_update', code: 'invalid_request', auditId: 'audit-failed', requestShape: { operation: 'update_task', fields: ['changes'], changeFields: ['current_step'], hasTaskId: false, hasExpectedVersion: false } }
        ]
      };
    },
    async close() {}
  });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  const result = await controller.handle('更新进度');
  assert.match(result.text, /部分更新未写入/);
  assert.match(result.text, /state_update=invalid_request/);
  assert.match(result.text, /update_task/);
  assert.match(result.text, /current_step/);
});

test('controller discovers an existing pilot project when the registry is missing', async () => {
  const f = fixture({ discoverExisting: true });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.saved, 'project-1');
});

test('controller does not create a legacy task projection for a Workstream', async () => {
  const f = fixture({ discoverExisting: true, activeTask: false });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.taskCreated, 0);
  assert.equal(f.calls.saved, 'project-1');
});

test('/new creates a distinct session while state and memory remain model-free', async () => {
  const f = fixture();
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  const state = await controller.handle('/state');
  const memory = await controller.handle('/memory');
  assert.match(state.text, /project-1/);
  assert.equal(memory.text, '未召回相关内容');
  assert.equal(f.calls.sessions[0].contexts.length, 0);
  const renewed = await controller.handle('/new');
  assert.equal(renewed.sessionId, 'session-2');
  assert.equal(f.calls.sessions[0].closed, true);
  assert.notEqual(renewed.previousSessionId, renewed.sessionId);
  assert.equal(f.calls.sessions[1].contexts[0].selected.some((item) => item.entityType === 'action' && item.entityId === 'action-1'), true);
});

test('/confirm-memory uses the host confirmation path', async () => {
  const f = fixture();
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  const result = await controller.handle('/confirm-memory memory-1 2');
  assert.equal(result.code, 'memory_confirmed');
  assert.equal(f.calls.confirmed.input.memoryId, 'memory-1');
  assert.equal(f.calls.confirmed.context.trustedConfirmation.actorType, 'user');
});

test('natural-language memory proposal exposes the host confirmation coordinates', async () => {
  const f = fixture();
  f.runtime.createSession = async () => ({
    id: 'session-memory',
    async send() {
      return {
        text: '我已提出候选记忆。', resultCodes: ['allowed'],
        toolResults: [{ toolName: 'memory_propose', code: 'allowed', auditId: 'audit-propose', entityId: 'memory-7', entityVersion: 1, confirmationRequired: true }]
      };
    },
    async close() {}
  });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  const proposed = await controller.handle('请记住我需要长期维护投递记录');
  assert.match(proposed.text, /memory-7/);
  assert.match(proposed.text, /v1/);
  assert.match(proposed.text, /需确认/);
  assert.deepEqual(proposed.trace.toolResults[0], {
    toolName: 'memory_propose', code: 'allowed', auditId: 'audit-propose', entityId: 'memory-7', entityVersion: 1, confirmationRequired: true
  });
});

test('/exit closes exactly once and provider failure is sanitized', async () => {
  const f = fixture();
  f.runtime.createSession = async () => ({ id: 'session-x', closes: 0, async send() { throw Object.assign(new Error('secret upstream body'), { code: 'PI_MODEL_UNAVAILABLE' }); }, async close() { this.closes += 1; } });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  const failed = await controller.handle('继续');
  assert.equal(failed.code, 'provider_unavailable');
  assert.doesNotMatch(failed.text, /secret/);
  await controller.handle('/exit');
  await controller.close();
  assert.equal(controller.closed, true);
});

test('terminal is a client of persistent Run start pause resume checkpoint and stop controls', async () => {
  const f = fixture({ persistentRun: true });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  const started = await controller.start();
  assert.equal(started.runId, 'run-1');
  assert.match((await controller.handle('/status')).text, /running.*run-1/s);
  assert.match((await controller.handle('/pause')).text, /paused/);
  assert.equal(f.calls.sessions[0].closed, true);
  assert.match((await controller.handle('/resume')).text, /running/);
  assert.equal(f.calls.sessions.length, 2);
  assert.match((await controller.handle('/checkpoint')).text, /checkpoint-manual/);
  assert.equal(f.calls.checkpointInput.stateVersion, 1);
  assert.equal(f.calls.checkpointInput.runVersion, 4);
  assert.match((await controller.handle('/stop')).text, /cancelled/);
  assert.equal(f.calls.sessions[1].closed, true);
});

test('restart reconciliation targets the persisted runtime before opening a new Session', async () => {
  const f = fixture({ persistentRun: true, discoverExisting: true, existingRunStatus: 'running' });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  const started = await controller.start();
  assert.equal(started.runStatus, 'paused');
  assert.equal(started.sessionId, null);
  assert.deepEqual(f.calls.haltedSessions, ['persisted-session']);
  assert.equal(f.calls.sessions.length, 0);
});

test('closing the terminal pauses a running persistent Run', async () => {
  const f = fixture({ persistentRun: true });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  await controller.close();
  assert.equal(f.calls.currentRun().status, 'paused');
  assert.equal(f.calls.sessions[0].closed, true);
});
