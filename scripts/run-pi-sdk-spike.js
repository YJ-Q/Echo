import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices
} from '@earendil-works/pi-coding-agent';
import { PI_BASELINE, assertSupportedNodeVersion } from '../src/runtime/pi/piBaseline.js';
import { MARGIN_SPIKE_TOOL_NAME, marginSpikeEchoExtension } from '../src/runtime/pi/piSpikeTool.js';

export function buildSpikeToolPolicy() {
  return {
    noTools: 'builtin',
    tools: [MARGIN_SPIKE_TOOL_NAME]
  };
}

export function buildIsolatedResourceOptions(extensionFactory = marginSpikeEchoExtension) {
  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: 'margin-stage-0-echo', hidden: false, factory: extensionFactory }]
  };
}

export function buildSpikePaths({ repositoryRoot, dataDir }) {
  const root = path.resolve(repositoryRoot);
  const resolvedDataDir = path.resolve(dataDir);
  const relative = path.relative(root, resolvedDataDir);
  if (!relative) {
    throw new Error('Pi spike data directory must not be the repository root.');
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Pi spike data directory must stay inside the repository.');
  }
  return {
    dataDir: resolvedDataDir,
    sessionDir: path.join(resolvedDataDir, 'sessions'),
    agentDir: path.join(resolvedDataDir, 'agent'),
    reportPath: path.join(resolvedDataDir, 'report.json')
  };
}

export function createSpikeEvidenceCollector(nonce) {
  const started = new Map();
  const completed = new Set();
  return {
    observe(event) {
      if (
        event.type === 'tool_execution_start' &&
        event.toolName === MARGIN_SPIKE_TOOL_NAME &&
        event.args?.message === nonce
      ) {
        started.set(event.toolCallId, event.args.message);
      }
      if (
        event.type === 'tool_execution_end' &&
        event.toolName === MARGIN_SPIKE_TOOL_NAME &&
        started.has(event.toolCallId) &&
        event.isError === false &&
        event.result?.content?.some((item) => item.type === 'text' && item.text === nonce)
      ) {
        completed.add(event.toolCallId);
      }
    },
    snapshot() {
      const toolCallCount = completed.size;
      return {
        toolCallCount,
        toolCalled: toolCallCount === 1,
        nonceMatched: toolCallCount === 1 && started.size === 1
      };
    }
  };
}

export function classifySpikeFailure(error) {
  const message = String(error?.message ?? error);
  if (error?.code === 'PI_MODEL_UNAVAILABLE' || /api key|auth|credential|login|token|model selected/i.test(message)) {
    return {
      exitCode: 3,
      report: { ok: false, blockedBy: 'pi_credentials_required', errorCode: error?.code === 'PI_MODEL_UNAVAILABLE' ? 'pi_model_unavailable' : 'pi_auth_unavailable' }
    };
  }
  return { exitCode: 4, report: { ok: false, blockedBy: 'pi_spike_failed', errorCode: 'pi_runtime_failure' } };
}

export function validateSpikeReport(report, { provider, modelId, now = new Date(), maxAgeMinutes = 15 }) {
  const createdAt = Date.parse(report?.createdAt);
  const ageMs = now.getTime() - createdAt;
  const requiredChecks = [
    'sessionCreated', 'inMemorySessionCreated', 'sessionRestored', 'sessionForked',
    'forkParentMatched', 'compactionStarted', 'compactionEnded', 'toolCalled', 'nonceMatched'
  ];
  const ok = report?.ok === true &&
    typeof report?.runId === 'string' && report.runId.length > 0 &&
    report?.baseline?.packageVersion === PI_BASELINE.packageVersion &&
    report?.baseline?.license === PI_BASELINE.license &&
    report?.observed?.nodeVersion === PI_BASELINE.runtimeNode &&
    report?.observed?.provider === provider &&
    report?.observed?.modelId === modelId &&
    Array.isArray(report?.observed?.enabledBuiltInTools) && report.observed.enabledBuiltInTools.length === 0 &&
    Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMinutes * 60_000 &&
    requiredChecks.every((name) => report?.checks?.[name] === true);
  return { ok, errorCode: ok ? null : 'pi_report_invalid_or_stale' };
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function runPiSdkSpike({ repositoryRoot, dataDir, provider, modelId, prompt }) {
  assertSupportedNodeVersion();
  const paths = buildSpikePaths({ repositoryRoot, dataDir });
  await mkdir(paths.sessionDir, { recursive: true });
  await mkdir(paths.agentDir, { recursive: true });
  await rm(paths.reportPath, { force: true });
  if (!provider || !modelId) {
    return { exitCode: 3, report: { ok: false, blockedBy: 'pi_credentials_required' } };
  }

  const nonce = `margin-pi-${Date.now()}`;
  const runId = randomUUID();
  const toolPolicy = buildSpikeToolPolicy();
  const inMemorySession = SessionManager.inMemory(repositoryRoot);
  const inMemorySessionCreated = Boolean(inMemorySession.getSessionId()) && inMemorySession.getSessionFile() === undefined;
  let runtime;

  try {
    const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: buildIsolatedResourceOptions()
      });
      const model = services.modelRuntime.getModel(provider, modelId);
      if (!model) {
        const error = new Error('Configured Pi model is unavailable.');
        error.code = 'PI_MODEL_UNAVAILABLE';
        throw error;
      }
      const sessionResult = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        noTools: toolPolicy.noTools,
        tools: toolPolicy.tools,
      });
      return { ...sessionResult, services, diagnostics: services.diagnostics };
    };

    runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: repositoryRoot,
      agentDir: paths.agentDir,
      sessionManager: SessionManager.create(repositoryRoot, paths.sessionDir)
    });

    const initialSessionId = runtime.session.sessionId;
    const initialSessionFile = runtime.session.sessionFile;
    const evidence = createSpikeEvidenceCollector(nonce);
    const unsubscribe = runtime.session.subscribe(evidence.observe);
    await runtime.session.prompt(
      prompt ?? `Call ${MARGIN_SPIKE_TOOL_NAME} exactly once with message "${nonce}", then reply with the echoed value.`
    );
    unsubscribe();

    await runtime.newSession();
    const freshSessionId = runtime.session.sessionId;
    await runtime.switchSession(initialSessionFile);
    const restoredSessionId = runtime.session.sessionId;
    const forkEntry = runtime.session.getUserMessagesForForking()[0];
    if (!forkEntry) throw new Error('Pi spike could not find a user entry to fork.');
    await runtime.fork(forkEntry.entryId, { position: 'at' });
    const forkedSessionId = runtime.session.sessionId;
    const forkParentMatched = runtime.session.sessionManager.getHeader()?.parentSession === initialSessionFile;

    let compactionStarted = false;
    let compactionEnded = false;
    const unsubscribeCompaction = runtime.session.subscribe((event) => {
      if (event.type === 'compaction_start') compactionStarted = true;
      if (event.type === 'compaction_end') compactionEnded = true;
    });
    await runtime.session.compact('Preserve the audit nonce and the fact that the echo tool was called.');
    unsubscribeCompaction();

    const activeTools = runtime.session.getActiveToolNames();
    const toolEvidence = evidence.snapshot();
    const report = {
      ok: true,
      runId,
      createdAt: new Date().toISOString(),
      baseline: PI_BASELINE,
      observed: {
        nodeVersion: process.versions.node,
        provider,
        modelId,
        enabledTools: activeTools,
        enabledBuiltInTools: activeTools.filter((name) => name !== MARGIN_SPIKE_TOOL_NAME)
      },
      checks: {
        sessionCreated: Boolean(initialSessionId && initialSessionFile),
        inMemorySessionCreated,
        newSessionCreated: freshSessionId !== initialSessionId,
        sessionRestored: restoredSessionId === initialSessionId,
        sessionForked: forkedSessionId !== initialSessionId,
        forkParentMatched,
        compactionStarted,
        compactionEnded,
        toolCalled: toolEvidence.toolCalled,
        nonceMatched: toolEvidence.nonceMatched
      }
    };
    report.ok = Object.values(report.checks).every(Boolean) && report.observed.enabledBuiltInTools.length === 0;
    await writeJsonAtomically(paths.reportPath, report);
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    return classifySpikeFailure(error);
  } finally {
    if (runtime) await runtime.dispose();
  }
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await runPiSdkSpike({
    repositoryRoot,
    dataDir: path.join(repositoryRoot, 'data', 'pi-spike'),
    provider: process.env.MARGIN_PI_PROVIDER,
    modelId: process.env.MARGIN_PI_MODEL,
    prompt: process.env.MARGIN_PI_SPIKE_PROMPT
  });
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
