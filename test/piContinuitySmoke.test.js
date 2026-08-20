import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTINUITY_TOOL_NAMES,
  assessContinuityIsolation,
  buildContinuityPaths,
  buildContinuityResourceOptions,
  buildContinuityToolPolicy,
  classifyContinuitySmokeFailure,
  runPiContinuitySmoke
} from '../src/runtime/pi/piContinuitySmoke.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('isolates Pi discovery and enables exactly the four Margin tools', () => {
  assert.deepEqual(buildContinuityToolPolicy(), {
    noTools: 'builtin',
    tools: ['memory_search', 'memory_propose', 'state_update', 'action_update']
  });

  const extensionFactory = () => {};
  assert.deepEqual(buildContinuityResourceOptions(extensionFactory), {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: 'margin-stage-3-continuity', hidden: false, factory: extensionFactory }]
  });
  assert.deepEqual(CONTINUITY_TOOL_NAMES, buildContinuityToolPolicy().tools);
});

test('rejects repository-root and out-of-repository evidence paths', () => {
  assert.throws(
    () => buildContinuityPaths({ repositoryRoot, dataDir: repositoryRoot }),
    /must not be the repository root/u
  );
  assert.throws(
    () => buildContinuityPaths({ repositoryRoot, dataDir: path.resolve(repositoryRoot, '..', 'outside') }),
    /must stay inside the repository/u
  );
});

test('writes a sanitized continuity report for distinct sessions and delivered planner digest', async (t) => {
  const dataDir = await mkdtemp(path.join(repositoryRoot, 'data', 'pi-continuity-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const secret = 'credential-never-persist';
  const fullPrompt = 'full prompt never persist';
  let executeCount = 0;

  const result = await runPiContinuitySmoke({
    repositoryRoot,
    dataDir,
    provider: 'fake-provider',
    modelId: 'fake-model',
    customProvider: { baseUrl: 'https://example.invalid/v1', api: 'openai-responses', apiKey: secret }
  }, {
    executeContinuity: async () => {
      executeCount += 1;
      return {
        sessionAId: 'session-A',
        sessionBId: 'session-B',
        enabledTools: [...CONTINUITY_TOOL_NAMES],
        sessionToolSets: [[...CONTINUITY_TOOL_NAMES], [...CONTINUITY_TOOL_NAMES]],
        projectId: 'project-1',
        taskId: 'task-1',
        contextDigest: 'digest-1',
        deliveredContextDigest: 'digest-1',
        resourcesIsolated: true,
        auditIds: ['audit-1'],
        resultCodes: ['allowed'],
        providerResponse: fullPrompt,
        rawProviderError: secret
      };
    },
    now: () => '2026-08-20T00:00:00.000Z',
    idFactory: () => 'run-1'
  });

  assert.equal(executeCount, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.ok, true);
  assert.notEqual(result.report.observed.sessionAId, result.report.observed.sessionBId);
  assert.equal(result.report.trace.contextDigest, 'digest-1');
  assert.deepEqual(result.report.checks, {
    toolsRegistered: true,
    sessionBoundary: true,
    contextDelivered: true,
    provenancePresent: true,
    safetyPolicy: true
  });
  assert.deepEqual(Object.keys(result.report), [
    'ok', 'runId', 'createdAt', 'baseline', 'observed', 'checks', 'trace'
  ]);

  const reportText = await readFile(path.join(dataDir, 'report.json'), 'utf8');
  assert.equal(reportText.includes(secret), false);
  assert.equal(reportText.includes(fullPrompt), false);
  assert.deepEqual(JSON.parse(reportText), result.report);
});

test('fails closed when runtime isolation evidence is absent', async (t) => {
  const dataDir = await mkdtemp(path.join(repositoryRoot, 'data', 'pi-continuity-unsafe-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const result = await runPiContinuitySmoke({
    repositoryRoot,
    dataDir,
    provider: 'fake-provider',
    modelId: 'fake-model',
    customProvider: { baseUrl: 'https://example.invalid/v1', api: 'openai-responses', apiKey: 'in-memory' }
  }, {
    executeContinuity: async () => ({
      sessionAId: 'session-A', sessionBId: 'session-B', enabledTools: [...CONTINUITY_TOOL_NAMES],
      sessionToolSets: [[...CONTINUITY_TOOL_NAMES], [...CONTINUITY_TOOL_NAMES]],
      projectId: 'project-1', taskId: 'task-1', contextDigest: 'digest-1', deliveredContextDigest: 'digest-1',
      auditIds: ['audit-1'], resultCodes: ['allowed']
    }),
    now: () => '2026-08-20T00:00:00.000Z',
    idFactory: () => 'run-unsafe'
  });

  assert.equal(result.exitCode, 4);
  assert.equal(result.report.checks.safetyPolicy, false);
  assert.deepEqual(result.report.trace.resultCodes, ['allowed', 'pi_continuity_failure']);
});

test('classifies failed continuity checks and preserves sanitized unexpected tool evidence', async (t) => {
  const dataDir = await mkdtemp(path.join(repositoryRoot, 'data', 'pi-continuity-failed-check-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const result = await runPiContinuitySmoke({
    repositoryRoot,
    dataDir,
    provider: 'fake-provider',
    modelId: 'fake-model',
    customProvider: { baseUrl: 'https://example.invalid/v1', api: 'openai-responses', apiKey: 'in-memory' }
  }, {
    executeContinuity: async () => ({
      sessionAId: 'session-A', sessionBId: 'session-B',
      enabledTools: [...CONTINUITY_TOOL_NAMES, 'bash'],
      sessionToolSets: [[...CONTINUITY_TOOL_NAMES], [...CONTINUITY_TOOL_NAMES, 'bash']],
      resourcesIsolated: true,
      projectId: 'project-1', taskId: 'task-1', contextDigest: 'digest-1', deliveredContextDigest: 'wrong-digest',
      auditIds: ['audit-1'], resultCodes: ['allowed']
    }),
    now: () => '2026-08-20T00:00:00.000Z',
    idFactory: () => 'run-failed-check'
  });

  assert.equal(result.exitCode, 4);
  assert.equal(result.report.ok, false);
  assert.deepEqual(result.report.observed.enabledTools, [...CONTINUITY_TOOL_NAMES, 'bash']);
  assert.equal(result.report.checks.toolsRegistered, false);
  assert.equal(result.report.checks.contextDelivered, false);
  assert.deepEqual(result.report.trace.resultCodes, ['allowed', 'pi_continuity_failure']);
});

test('observes resource discovery and both sessions before claiming isolation', () => {
  const resourceLoader = {
    getExtensions: () => ({ extensions: [{}] }),
    getSkills: () => ({ skills: [] }),
    getPrompts: () => ({ prompts: [] }),
    getThemes: () => ({ themes: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getAppendSystemPrompt: () => []
  };
  const sessions = [
    { session: { sessionFile: undefined }, activeTools: [...CONTINUITY_TOOL_NAMES] },
    { session: { sessionFile: undefined }, activeTools: [...CONTINUITY_TOOL_NAMES] }
  ];

  assert.equal(assessContinuityIsolation({ resourceLoader, sessions }), true);
  assert.equal(assessContinuityIsolation({
    resourceLoader: { ...resourceLoader, getSkills: () => ({ skills: [{ name: 'external' }] }) },
    sessions
  }), false);
  assert.equal(assessContinuityIsolation({
    resourceLoader,
    sessions: [sessions[0], { ...sessions[1], session: { sessionFile: 'persisted.jsonl' } }]
  }), false);
});

test('classifies credential, provider, adapter, and continuity failures with stable codes', () => {
  assert.deepEqual(classifyContinuitySmokeFailure(Object.assign(new Error('secret'), { code: 'PI_CREDENTIALS_REQUIRED' })), {
    exitCode: 3, errorCode: 'pi_credentials_required'
  });
  assert.deepEqual(classifyContinuitySmokeFailure(Object.assign(new Error('secret'), { code: 'PI_MODEL_UNAVAILABLE' })), {
    exitCode: 4, errorCode: 'pi_provider_unavailable'
  });
  assert.deepEqual(classifyContinuitySmokeFailure(Object.assign(new Error('secret'), { code: 'adapter_execution_failed' })), {
    exitCode: 4, errorCode: 'pi_adapter_failure'
  });
  assert.deepEqual(classifyContinuitySmokeFailure(new Error('secret')), {
    exitCode: 4, errorCode: 'pi_continuity_failure'
  });
  assert.deepEqual(classifyContinuitySmokeFailure(Object.assign(new Error('maximum tokens exceeded'), { stage: 'provider_prompt' })), {
    exitCode: 4, errorCode: 'pi_provider_unavailable'
  });
});

test('does not execute the live composition when credentials are absent', async (t) => {
  const dataDir = await mkdtemp(path.join(repositoryRoot, 'data', 'pi-continuity-blocked-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let executed = false;
  const result = await runPiContinuitySmoke({
    repositoryRoot, dataDir, provider: 'yapi', modelId: 'fake-model'
  }, {
    executeContinuity: async () => { executed = true; },
    now: () => '2026-08-20T00:00:00.000Z',
    idFactory: () => 'run-blocked'
  });

  assert.equal(executed, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.report.ok, false);
  assert.deepEqual(result.report.trace.resultCodes, ['pi_credentials_required']);
});

test('CLI reads only the approved Pi environment wiring and uses pinned Node', async () => {
  const script = await readFile(path.join(repositoryRoot, 'scripts', 'run-pi-continuity-smoke.js'), 'utf8');
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const environmentReads = [...script.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[([^\]]+)\])/gu)]
    .map((match) => match[1] ?? `[${match[2]}]`);

  assert.deepEqual(environmentReads, [
    'MARGIN_PI_PROVIDER', 'MARGIN_PI_MODEL', 'MARGIN_PI_BASE_URL', 'MARGIN_PI_API',
    'MARGIN_PI_API_KEY_ENV', '[apiKeyEnvironmentName]'
  ]);
  assert.equal(packageJson.scripts['spike:pi-continuity'],
    '.\\.runtime\\node-v22.23.1-win-x64\\node.exe scripts/run-pi-continuity-smoke.js');
});
