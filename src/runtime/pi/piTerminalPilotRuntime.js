import {
  SessionManager, SettingsManager, createAgentSessionFromServices, createAgentSessionServices
} from '@earendil-works/pi-coding-agent';
import { createMarginPiExtension } from './marginPiAdapter.js';
import { buildContinuityResourceOptions, buildContinuityToolPolicy, CONTINUITY_TOOL_NAMES } from './piContinuitySmoke.js';

const sameTools = (actual) => Array.isArray(actual) && actual.length === CONTINUITY_TOOL_NAMES.length &&
  CONTINUITY_TOOL_NAMES.every((name) => actual.includes(name));

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
  const sessions = new Set();

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
      sessions.add(session);
      let disposed = false;
      return {
        id: session.sessionId,
        async send({ context, message }) {
          currentToolResults = [];
          await session.sendCustomMessage({
            customType: 'margin_terminal_pilot_context',
            content: JSON.stringify({ digest: context.digest, selected: context.selected }),
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
          sessions.delete(session);
          session.dispose();
        }
      };
    },
    async close() {
      for (const session of sessions) session.dispose();
      sessions.clear();
    }
  };
}
