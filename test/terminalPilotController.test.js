import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalPilotController } from '../src/pilot/terminalPilotController.js';

function fixture({ discoverExisting = false, activeTask = true } = {}) {
  const calls = { created: 0, taskCreated: 0, sessions: [], saved: null, queries: [] };
  const project = { id: 'project-1', version: 1, goal: '持续完成简历投递并维护投递记录', phase: 'pilot', status: 'active' };
  const snapshot = { project, activeTask: { id: 'task-1', version: 1, title: '推进投递', current_step: '记录下一次投递' }, decisions: [], memories: [], recentDialogue: [] };
  const core = {
    store: {
      async getProject(id) { return id === project.id ? project : null; },
      async findActiveProjectByScenario() { return discoverExisting ? project : null; },
      async findActiveTaskByProject() { return activeTask ? snapshot.activeTask : null; },
      async createProject() { calls.created += 1; return project; },
      async createTask() { calls.taskCreated += 1; return snapshot.activeTask; },
      async getContinuitySnapshot(input) { calls.queries.push(input); return snapshot; },
      db: { async all() { return [{ id: 'action-1', version: 2, title: '投递示例公司', status: 'pending', source_session_id: 'session-1' }]; } }
    },
    async planContext() { return { projectId: project.id, selected: [], excluded: [], digest: 'digest-1' }; },
    tools: { memory_search() {}, memory_propose() {}, state_update() {}, action_update() {} },
    async confirmMemory(input, context) { calls.confirmed = { input, context }; return { memory: { id: input.memoryId, version: 3 }, auditId: 'audit-confirm' }; }
  };
  let next = 0;
  const runtime = {
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
});

test('controller discovers an existing pilot project when the registry is missing', async () => {
  const f = fixture({ discoverExisting: true });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.saved, 'project-1');
});

test('controller repairs a discovered pilot project whose initial task was not committed', async () => {
  const f = fixture({ discoverExisting: true, activeTask: false });
  const controller = createTerminalPilotController({ core: f.core, runtime: f.runtime, registry: f.registry, clock: () => '2026-08-23T00:00:00.000Z', idFactory: (p) => `${p}-1` });
  await controller.start();
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.taskCreated, 1);
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
