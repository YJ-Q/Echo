import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPiTerminalPilotOptions, createPiTerminalPilotRuntime } from '../src/runtime/pi/piTerminalPilotRuntime.js';

test('buildPiTerminalPilotOptions keeps only four Margin tools and isolates resources', () => {
  const options = buildPiTerminalPilotOptions(() => {});
  assert.equal(options.policy.noTools, 'builtin');
  assert.deepEqual(options.policy.tools, ['memory_search', 'memory_propose', 'state_update', 'action_update']);
  assert.equal(options.resources.noExtensions, true);
  assert.equal(options.resources.noSkills, true);
  assert.equal(options.resources.noPromptTemplates, true);
  assert.equal(options.resources.noThemes, true);
  assert.equal(options.resources.noContextFiles, true);
});

test('runtime creates isolated sessions and sends hidden context before prompting', async () => {
  const records = [];
  const services = { modelRuntime: { getModel: () => ({ id: 'model' }) }, resourceLoader: {} };
  const runtime = await createPiTerminalPilotRuntime({
    repositoryRoot: 'D:/repo', agentDir: 'D:/repo/data/terminal-pilot/agent', provider: 'test', modelId: 'model',
    tools: { memory_search() {}, memory_propose() {}, state_update() {}, action_update() {} },
    getInvocationContext: async () => ({}),
    dependencies: {
      async createServices(options) { records.push({ services: options }); return services; },
      sessionManager: { inMemory: () => ({}) },
      settingsManager: { inMemory: () => ({}) },
      async createSession(options) {
        records.push({ session: options });
        return { session: {
          sessionId: 'session-1', getActiveToolNames: () => ['memory_search', 'memory_propose', 'state_update', 'action_update'],
          async sendCustomMessage(message, config) { records.push({ message, config }); },
          async prompt(text) { records.push({ prompt: text }); }, getLastAssistantText: () => '已恢复', dispose() { records.push({ disposed: true }); }
        } };
      }
    }
  });
  const session = await runtime.createSession();
  const response = await session.send({ context: { digest: 'digest-1', selected: [] }, message: '继续' });
  assert.equal(response.text, '已恢复');
  assert.equal(records.find((r) => r.message).message.display, false);
  assert.equal(records.find((r) => r.prompt).prompt, '继续');
  await session.close();
  assert.equal(records.at(-1).disposed, true);
});

test('runtime rejects unexpected active tools', async () => {
  await assert.rejects(() => createPiTerminalPilotRuntime({
    repositoryRoot: 'D:/repo', agentDir: 'D:/repo/data/terminal-pilot/agent', provider: 'test', modelId: 'model', tools: {},
    getInvocationContext: async () => ({}),
    dependencies: {
      createServices: async () => ({ modelRuntime: { getModel: () => ({}) } }),
      sessionManager: { inMemory: () => ({}) }, settingsManager: { inMemory: () => ({}) },
      createSession: async () => ({ session: { sessionId: 'bad', getActiveToolNames: () => ['bash'] } })
    }
  }).then((runtime) => runtime.createSession()), /pilot_tool_boundary_violation/);
});

test('createSession binds the controller-owned invocation context', async () => {
  const registered = new Map();
  let observed;
  const runtime = await createPiTerminalPilotRuntime({
    repositoryRoot: 'D:/repo', agentDir: 'D:/repo/data/terminal-pilot/agent', provider: 'test', modelId: 'model',
    tools: {
      async memory_search(input, context) { observed = { input, context }; return { ok: true, data: [] }; },
      memory_propose() {}, state_update() {}, action_update() {}
    },
    dependencies: {
      async createServices(options) {
        await options.resourceLoaderOptions.extensionFactories[0].factory({ registerTool(tool) { registered.set(tool.name, tool); } });
        return { modelRuntime: { getModel: () => ({}) } };
      },
      sessionManager: { inMemory: () => ({}) }, settingsManager: { inMemory: () => ({}) },
      createSession: async () => ({ session: { sessionId: 'bound', getActiveToolNames: () => ['memory_search', 'memory_propose', 'state_update', 'action_update'], dispose() {} } })
    }
  });
  await runtime.createSession({ getInvocationContext: async () => ({ actorType: 'agent', permissions: { memoryRead: true }, sourceSessionId: 'bound' }) });
  await registered.get('memory_search').execute('call-1', { requestId: 'r', projectId: 'p', query: 'q', asOf: '2026-08-23T00:00:00.000Z' });
  assert.equal(observed.input.sourceSessionId, 'bound');
  assert.equal(observed.context.permissions.memoryRead, true);
});
