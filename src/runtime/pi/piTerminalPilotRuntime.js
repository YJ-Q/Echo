import {
  SessionManager, SettingsManager, createAgentSessionFromServices, createAgentSessionServices
} from '@earendil-works/pi-coding-agent';
import { createMarginPiExtension } from './marginPiAdapter.js';
import { buildContinuityResourceOptions, buildContinuityToolPolicy, CONTINUITY_TOOL_NAMES } from './piContinuitySmoke.js';

const sameTools = (actual) => Array.isArray(actual) && actual.length === CONTINUITY_TOOL_NAMES.length &&
  CONTINUITY_TOOL_NAMES.every((name) => actual.includes(name));

const PILOT_OPERATION_RULES = [
  '状态或行动发生变化时调用相应工具；不得只在回复中声称已经记录。',
  '更新已有 Workstream 或 action 时，必须使用上下文中的 entityId 和 version 作为 expectedVersion。',
  '终端 V1 不创建或更新 legacy task；Workstream 的 goal、phase、status 只通过 update_project 更新。',
  '完成旧行动后，如用户已给出明确下一步，应创建对应的 pending、internal_write 行动。',
  '长期信息只能通过 memory_propose 提出候选；不得声称候选已经确认。',
  '任何工具返回非 allowed 时，必须明确说明对应更新失败，不得声称全部更新成功。'
].join(' ');

export function buildPiTerminalPilotOptions(extensionFactory) {
  return { policy: buildContinuityToolPolicy(), resources: buildContinuityResourceOptions(extensionFactory) };
}

function providerExtension({ provider, modelId, customProvider, tools, getInvocationContext, onToolResult }) {
  const margin = createMarginPiExtension({ tools, getInvocationContext, onToolResult });
  return async (pi) => {
    if (customProvider) {
      pi.registerProvider(provider, {
        name: provider.toUpperCase(), baseUrl: customProvider.baseUrl, apiKey: customProvider.apiKey, api: customProvider.api,
        models: [{ id: modelId, name: modelId, api: customProvider.api, reasoning: true, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 }]
      });
    }
    await margin(pi);
  };
}

export async function createPiTerminalPilotRuntime({
  repositoryRoot, agentDir, provider, modelId, customProvider, tools, getInvocationContext,
  dependencies = {}
}) {
  const deps = {
    createServices: dependencies.createServices ?? createAgentSessionServices,
    createSession: dependencies.createSession ?? createAgentSessionFromServices,
    sessionManager: dependencies.sessionManager ?? SessionManager,
    settingsManager: dependencies.settingsManager ?? SettingsManager
  };
  let invocationContextProvider = getInvocationContext ?? (async () => undefined);
  let currentToolResults = [];
  const extension = providerExtension({
    provider, modelId, customProvider, tools,
    getInvocationContext: (input) => invocationContextProvider(input),
    onToolResult: (result) => currentToolResults.push(result)
  });
  const options = buildPiTerminalPilotOptions(extension);
  const services = await deps.createServices({
    cwd: repositoryRoot, agentDir,
    settingsManager: deps.settingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: false } }),
    resourceLoaderOptions: options.resources
  });
  const model = services.modelRuntime.getModel(provider, modelId);
  if (!model) throw Object.assign(new Error('pilot_model_unavailable'), { code: 'PI_MODEL_UNAVAILABLE' });
  const sessions = new Map();

  return {
    async createSession({ getInvocationContext: sessionInvocationContext } = {}) {
      if (sessionInvocationContext) invocationContextProvider = sessionInvocationContext;
      const { session } = await deps.createSession({
        services, sessionManager: deps.sessionManager.inMemory(repositoryRoot), model,
        noTools: options.policy.noTools, tools: options.policy.tools
      });
      if (!session?.sessionId || !sameTools(session.getActiveToolNames?.())) {
        session?.dispose?.();
        throw new Error('pilot_tool_boundary_violation');
      }
      sessions.set(session.sessionId, session);
      let disposed = false;
      return {
        id: session.sessionId,
        async send({ context, message }) {
          currentToolResults = [];
          await session.sendCustomMessage({
            customType: 'margin_terminal_pilot_context',
            content: JSON.stringify({ digest: context.digest, selected: context.selected, operationRules: PILOT_OPERATION_RULES, writeRouting: context.writeRouting }),
            display: false, details: { digest: context.digest }
          }, { triggerTurn: false });
          await session.prompt(message);
          const toolResults = currentToolResults.map((item) => ({ ...item }));
          return {
            text: session.getLastAssistantText?.() ?? '',
            resultCodes: toolResults.length ? toolResults.map((item) => item.code) : ['no_tool_call'],
            toolResults
          };
        },
        async close() {
          if (disposed) return;
          disposed = true;
          sessions.delete(session.sessionId);
          session.dispose();
        }
      };
    },
    async haltSession(sessionId) {
      const target = sessions.get(sessionId);
      if (!target) return { halted: false, reason: 'already_absent' };
      sessions.delete(sessionId);
      target.dispose();
      return { halted: true };
    },
    async close() {
      for (const session of sessions.values()) session.dispose();
      sessions.clear();
    }
  };
}
