import { randomUUID } from 'node:crypto';
import { mkdir, realpath as fsRealpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionServices
} from '@earendil-works/pi-coding-agent';
import { runContinuityHarness } from '../../continuity/continuityHarness.js';
import { createMarginCore } from '../../core/createMarginCore.js';
import { createMarginPiExtension } from './marginPiAdapter.js';
import { PI_BASELINE, assertSupportedNodeVersion } from './piBaseline.js';

export const CONTINUITY_TOOL_NAMES = Object.freeze([
  'memory_search',
  'memory_propose',
  'state_update',
  'action_update'
]);

const DEFAULT_CLOCK = () => new Date().toISOString();
const DEFAULT_PROJECT_SEED = Object.freeze({
  scenario: 'pi_continuity_smoke',
  goal: 'verify isolated cross-session continuity',
  phase: 'continuity',
  task: {
    title: 'Verify continuity handoff',
    currentStep: 'deliver the planner context to a fresh session',
    completionCondition: 'the fresh session returns the planner digest',
    status: 'active'
  }
});

function sameTools(actual) {
  return Array.isArray(actual) &&
    actual.length === CONTINUITY_TOOL_NAMES.length &&
    CONTINUITY_TOOL_NAMES.every((name) => actual.includes(name));
}

function sanitizedToolNames(actual) {
  if (!Array.isArray(actual)) return [];
  return [...new Set(actual
    .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 128)
    .slice(0, 32))];
}

function tagError(error, stage, code) {
  const tagged = error instanceof Error ? error : new Error(String(error));
  if (!tagged.stage) tagged.stage = stage;
  if (code && !tagged.code) tagged.code = code;
  return tagged;
}

export function buildContinuityToolPolicy() {
  return {
    noTools: 'builtin',
    tools: [...CONTINUITY_TOOL_NAMES]
  };
}

export function buildContinuityResourceOptions(extensionFactory) {
  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{
      name: 'margin-stage-3-continuity',
      hidden: false,
      factory: extensionFactory
    }]
  };
}

export function buildContinuityPaths({ repositoryRoot, dataDir }) {
  const root = path.resolve(repositoryRoot);
  const resolvedDataDir = path.resolve(dataDir);
  const relative = path.relative(root, resolvedDataDir);
  if (!relative) {
    throw new Error('Pi continuity data directory must not be the repository root.');
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Pi continuity data directory must stay inside the repository.');
  }
  return {
    repositoryRoot: root,
    dataDir: resolvedDataDir,
    sessionDir: path.join(resolvedDataDir, 'sessions'),
    agentDir: path.join(resolvedDataDir, 'agent'),
    dbPath: path.join(resolvedDataDir, 'margin-core.sqlite'),
    reportPath: path.join(resolvedDataDir, 'report.json')
  };
}

async function resolveNearestExistingPath(target, realpath) {
  let current = path.resolve(target);
  const missingSegments = [];
  while (true) {
    try {
      return path.resolve(await realpath(current), ...missingSegments);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function assertContinuityPathsContained(paths, { realpath = fsRealpath } = {}) {
  const realRoot = await resolveNearestExistingPath(paths.repositoryRoot, realpath);
  for (const target of [paths.dataDir, paths.sessionDir, paths.agentDir, paths.dbPath, paths.reportPath]) {
    const resolvedTarget = await resolveNearestExistingPath(target, realpath);
    const relative = path.relative(realRoot, resolvedTarget);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Pi continuity resolved path must stay inside the repository.');
    }
  }
}

export function classifyContinuitySmokeFailure(error) {
  const code = String(error?.code ?? '');
  const stage = String(error?.stage ?? '');
  const message = String(error?.message ?? '');
  if (
    code === 'PI_CREDENTIALS_REQUIRED' ||
    /api[-_ ]?key|authentication|unauthoriz|forbidden|credentials?|\blogin\b|(?:invalid|expired|missing)\s+(?:access\s+)?token/i.test(message)
  ) {
    return { exitCode: 3, errorCode: 'pi_credentials_required' };
  }
  if (code === 'PI_MODEL_UNAVAILABLE' || stage.startsWith('provider')) {
    return { exitCode: 4, errorCode: 'pi_provider_unavailable' };
  }
  if (code === 'PI_ADAPTER_FAILURE' || code.startsWith('adapter_') || stage.startsWith('adapter')) {
    return { exitCode: 4, errorCode: 'pi_adapter_failure' };
  }
  return { exitCode: 4, errorCode: 'pi_continuity_failure' };
}

export function assessContinuityIsolation({ resourceLoader, sessions }) {
  try {
    const extensions = resourceLoader?.getExtensions?.()?.extensions;
    const skills = resourceLoader?.getSkills?.()?.skills;
    const prompts = resourceLoader?.getPrompts?.()?.prompts;
    const themes = resourceLoader?.getThemes?.()?.themes;
    const agentsFiles = resourceLoader?.getAgentsFiles?.()?.agentsFiles;
    const appendSystemPrompt = resourceLoader?.getAppendSystemPrompt?.();
    return Array.isArray(extensions) && extensions.length <= 1 &&
      Array.isArray(skills) && skills.length === 0 &&
      Array.isArray(prompts) && prompts.length === 0 &&
      Array.isArray(themes) && themes.length === 0 &&
      Array.isArray(agentsFiles) && agentsFiles.length === 0 &&
      Array.isArray(appendSystemPrompt) && appendSystemPrompt.length === 0 &&
      Array.isArray(sessions) && sessions.length === 2 &&
      sessions.every((record) => record?.session?.sessionFile === undefined && sameTools(record?.activeTools));
  } catch {
    return false;
  }
}

function createReport({ runId, createdAt, provider, modelId, execution, errorCode }) {
  const enabledTools = sanitizedToolNames(execution?.enabledTools);
  const sessionToolSets = Array.isArray(execution?.sessionToolSets) ? execution.sessionToolSets : [];
  const toolsRegistered = sessionToolSets.length === 2 && sessionToolSets.every(sameTools);
  const sessionBoundary = Boolean(
    execution?.sessionAId && execution?.sessionBId && execution.sessionAId !== execution.sessionBId
  );
  const contextDelivered = Boolean(
    execution?.contextDigest && execution.contextDigest === execution?.deliveredContextDigest
  );
  const auditIds = [execution?.auditIds, execution?.confirmationAuditIds]
    .flatMap((values) => Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.length > 0);
  const resultCodes = errorCode
    ? [errorCode]
    : Array.isArray(execution?.resultCodes)
      ? execution.resultCodes.filter((value) => typeof value === 'string')
      : [];
  const checks = {
    toolsRegistered,
    sessionBoundary,
    contextDelivered,
    provenancePresent: auditIds.length > 0,
    safetyPolicy: toolsRegistered && execution?.resourcesIsolated === true
  };
  const ok = !errorCode && Object.values(checks).every(Boolean);
  if (!ok && !errorCode && !resultCodes.includes('pi_continuity_failure')) {
    resultCodes.push('pi_continuity_failure');
  }
  return {
    ok,
    runId,
    createdAt,
    baseline: PI_BASELINE,
    observed: {
      provider: provider ?? null,
      modelId: modelId ?? null,
      sessionAId: execution?.sessionAId ?? null,
      sessionBId: execution?.sessionBId ?? null,
      enabledTools
    },
    checks,
    trace: {
      projectId: execution?.projectId ?? null,
      taskId: execution?.taskId ?? null,
      contextDigest: execution?.contextDigest ?? null,
      auditIds,
      resultCodes
    }
  };
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function createProviderAwareExtension({ provider, modelId, customProvider, tools, invocationContexts }) {
  const adapterExtension = createMarginPiExtension({
    tools,
    getInvocationContext: async ({ toolCallId }) => invocationContexts.get(toolCallId)
  });
  return async (pi) => {
    if (customProvider) {
      pi.registerProvider(provider, {
        name: provider.toUpperCase(),
        baseUrl: customProvider.baseUrl,
        apiKey: customProvider.apiKey,
        api: customProvider.api,
        models: [{
          id: modelId,
          name: modelId,
          api: customProvider.api,
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384
        }]
      });
    }
    await adapterExtension(pi);
  };
}

async function parseAdapterResult(toolName, result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  try {
    const parsed = JSON.parse(text);
    if (!parsed?.ok) {
      throw Object.assign(new Error('Margin Pi adapter rejected the smoke operation.'), {
        code: parsed?.error?.code ?? 'PI_ADAPTER_FAILURE'
      });
    }
    return parsed;
  } catch (error) {
    throw tagError(error, `adapter_${toolName}`, 'PI_ADAPTER_FAILURE');
  }
}

async function executeLiveContinuity({ repositoryRoot, paths, provider, modelId, customProvider }) {
  const invocationContexts = new Map();
  const core = await createMarginCore({ enabled: true, dbPath: paths.dbPath });
  let services;
  try {
    const extensionFactory = createProviderAwareExtension({
      provider,
      modelId,
      customProvider,
      tools: core.tools,
      invocationContexts
    });
    try {
      services = await createAgentSessionServices({
        cwd: repositoryRoot,
        agentDir: paths.agentDir,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false }
        }),
        resourceLoaderOptions: buildContinuityResourceOptions(extensionFactory)
      });
    } catch (error) {
      throw tagError(error, 'provider_services');
    }
    const model = services.modelRuntime.getModel(provider, modelId);
    if (!model) {
      throw tagError(new Error('Configured Pi model is unavailable.'), 'provider_model', 'PI_MODEL_UNAVAILABLE');
    }

    const policy = buildContinuityToolPolicy();
    const sessions = [];
    const sessionFactory = async () => {
      let session;
      try {
        ({ session } = await createAgentSessionFromServices({
          services,
          sessionManager: SessionManager.inMemory(repositoryRoot),
          model,
          noTools: policy.noTools,
          tools: policy.tools
        }));
      } catch (error) {
        throw tagError(error, 'provider_session');
      }
      const record = {
        session,
        activeTools: session.getActiveToolNames(),
        deliveredContextDigest: null,
        providerDigestMatched: false
      };
      sessions.push(record);
      return {
        id: session.sessionId,
        async invokeTool(name, input) {
          const definition = session.getToolDefinition(name);
          if (!definition || !CONTINUITY_TOOL_NAMES.includes(name)) {
            throw tagError(new Error('Required Margin tool is unavailable.'), `adapter_${name}`, 'PI_ADAPTER_FAILURE');
          }
          const toolCallId = randomUUID();
          invocationContexts.set(toolCallId, {
            actorType: 'agent',
            permissions: { memoryRead: true, memoryWrite: true, stateWrite: true, actionWrite: true },
            confirmations: [],
            sourceSessionId: session.sessionId,
            sourceEventId: toolCallId
          });
          try {
            return await parseAdapterResult(name, await definition.execute(toolCallId, input));
          } finally {
            invocationContexts.delete(toolCallId);
          }
        },
        async receiveContext(plan) {
          record.deliveredContextDigest = plan.digest;
          await session.sendCustomMessage({
            customType: 'margin_continuity_context',
            content: JSON.stringify({ digest: plan.digest, selected: plan.selected }),
            display: false,
            details: { digest: plan.digest }
          }, { triggerTurn: false });
          try {
            await session.prompt('Return only the digest supplied in the Margin continuity context.');
          } catch (error) {
            throw tagError(error, 'provider_prompt');
          }
          record.providerDigestMatched = session.getLastAssistantText()?.trim() === plan.digest;
        },
        async close() {
          session.dispose();
        }
      };
    };

    const harness = await runContinuityHarness({
      store: core.store,
      tools: core.tools,
      sessionFactory,
      projectSeed: DEFAULT_PROJECT_SEED,
      continuationQuery: 'continue the isolated continuity verification',
      clock: DEFAULT_CLOCK,
      idFactory: (prefix) => `${prefix}-${randomUUID()}`
    });
    const sessionB = sessions[1];
    const sessionToolSets = sessions.map((record) => sanitizedToolNames(record.activeTools));
    return {
      sessionAId: harness.sessionAId,
      sessionBId: harness.sessionBId,
      enabledTools: sanitizedToolNames(sessionToolSets.flat()),
      sessionToolSets,
      resourcesIsolated: assessContinuityIsolation({ resourceLoader: services.resourceLoader, sessions }),
      projectId: harness.projectId,
      taskId: harness.taskId,
      contextDigest: harness.context.digest,
      deliveredContextDigest: sessionB?.providerDigestMatched ? sessionB.deliveredContextDigest : null,
      auditIds: harness.trace.toolResults.map((entry) => entry.auditId),
      confirmationAuditIds: harness.trace.confirmationAuditIds,
      resultCodes: harness.trace.toolResults.map((entry) => entry.code)
    };
  } finally {
    await core.close();
  }
}

export async function runPiContinuitySmoke({
  repositoryRoot,
  dataDir,
  provider,
  modelId,
  customProvider
}, {
  executeContinuity = executeLiveContinuity,
  now = DEFAULT_CLOCK,
  idFactory = () => randomUUID()
} = {}) {
  assertSupportedNodeVersion();
  const paths = buildContinuityPaths({ repositoryRoot, dataDir });
  await assertContinuityPathsContained(paths);
  await mkdir(paths.sessionDir, { recursive: true });
  await mkdir(paths.agentDir, { recursive: true });
  await assertContinuityPathsContained(paths);
  await rm(paths.reportPath, { force: true });

  const runId = idFactory('pi_continuity_run');
  const createdAt = now();
  if (!provider || !modelId || !customProvider?.apiKey) {
    const report = createReport({
      runId, createdAt, provider, modelId, errorCode: 'pi_credentials_required'
    });
    await assertContinuityPathsContained(paths);
    await writeJsonAtomically(paths.reportPath, report);
    return { exitCode: 3, report };
  }

  try {
    await assertContinuityPathsContained(paths);
    const execution = await executeContinuity({
      repositoryRoot,
      paths,
      provider,
      modelId,
      customProvider
    });
    const report = createReport({ runId, createdAt, provider, modelId, execution });
    await assertContinuityPathsContained(paths);
    await writeJsonAtomically(paths.reportPath, report);
    return { exitCode: report.ok ? 0 : 4, report };
  } catch (error) {
    const failure = classifyContinuitySmokeFailure(error);
    const report = createReport({
      runId,
      createdAt,
      provider,
      modelId,
      errorCode: failure.errorCode
    });
    await assertContinuityPathsContained(paths);
    await writeJsonAtomically(paths.reportPath, report);
    return { exitCode: failure.exitCode, report };
  }
}
