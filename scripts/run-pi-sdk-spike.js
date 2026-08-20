import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir
} from '@earendil-works/pi-coding-agent';
import { PI_BASELINE, assertSupportedNodeVersion } from '../src/runtime/pi/piBaseline.js';
import { MARGIN_SPIKE_TOOL_NAME, marginSpikeEchoTool } from '../src/runtime/pi/piSpikeTool.js';

export function buildSpikeToolPolicy() {
  return {
    noTools: 'builtin',
    tools: [MARGIN_SPIKE_TOOL_NAME]
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
    reportPath: path.join(resolvedDataDir, 'report.json')
  };
}

function sanitizedError(error) {
  return String(error?.message ?? error)
    .replace(/[A-Za-z]:\\[^\s]+/g, '<local-path>')
    .slice(0, 500);
}

function isCredentialError(error) {
  return /api key|auth|credential|login|token|model selected/i.test(String(error?.message ?? error));
}

export async function runPiSdkSpike({ repositoryRoot, dataDir, provider, modelId, prompt }) {
  assertSupportedNodeVersion();
  if (!provider || !modelId) {
    return { exitCode: 3, report: { ok: false, blockedBy: 'pi_credentials_required' } };
  }

  const paths = buildSpikePaths({ repositoryRoot, dataDir });
  await mkdir(paths.sessionDir, { recursive: true });
  const nonce = `margin-pi-${Date.now()}`;
  const toolPolicy = buildSpikeToolPolicy();
  let runtime;

  try {
    const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd, agentDir });
      const model = services.modelRuntime.getModel(provider, modelId);
      if (!model) {
        throw new Error(`Configured Pi model was not found: ${provider}/${modelId}`);
      }
      const sessionResult = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        noTools: toolPolicy.noTools,
        tools: toolPolicy.tools,
        customTools: [marginSpikeEchoTool]
      });
      return { ...sessionResult, services, diagnostics: services.diagnostics };
    };

    runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: repositoryRoot,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(repositoryRoot, paths.sessionDir)
    });

    const initialSessionId = runtime.session.sessionId;
    const initialSessionFile = runtime.session.sessionFile;
    let toolCalled = false;
    const unsubscribe = runtime.session.subscribe((event) => {
      if (JSON.stringify(event).includes(MARGIN_SPIKE_TOOL_NAME)) toolCalled = true;
    });
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

    let compactionStarted = false;
    let compactionEnded = false;
    const unsubscribeCompaction = runtime.session.subscribe((event) => {
      if (event.type === 'compaction_start') compactionStarted = true;
      if (event.type === 'compaction_end') compactionEnded = true;
    });
    await runtime.session.compact('Preserve the audit nonce and the fact that the echo tool was called.');
    unsubscribeCompaction();

    const activeTools = runtime.session.getActiveToolNames();
    const report = {
      ok: true,
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
        newSessionCreated: freshSessionId !== initialSessionId,
        sessionRestored: restoredSessionId === initialSessionId,
        sessionForked: forkedSessionId !== initialSessionId,
        compactionStarted,
        compactionEnded,
        toolCalled
      }
    };
    report.ok = Object.values(report.checks).every(Boolean) && report.observed.enabledBuiltInTools.length === 0;
    await writeFile(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { exitCode: report.ok ? 0 : 1, report };
  } catch (error) {
    if (isCredentialError(error)) {
      return {
        exitCode: 3,
        report: { ok: false, blockedBy: 'pi_credentials_required', error: sanitizedError(error) }
      };
    }
    return { exitCode: 4, report: { ok: false, blockedBy: 'pi_spike_failed', error: sanitizedError(error) } };
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
