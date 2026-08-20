import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildIsolatedResourceOptions,
  buildSpikePaths,
  buildSpikeToolPolicy,
  classifySpikeFailure,
  createSpikeEvidenceCollector,
  validateSpikeReport
} from '../scripts/run-pi-sdk-spike.js';

test('spike policy disables every built-in tool and allows only the audit tool', () => {
  assert.deepEqual(buildSpikeToolPolicy(), {
    noTools: 'builtin',
    tools: ['margin_spike_echo']
  });
});

test('spike resource loading is isolated from user and project resources', () => {
  const options = buildIsolatedResourceOptions(() => {});
  assert.deepEqual(options, {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: 'margin-stage-0-echo', hidden: false, factory: options.extensionFactories[0].factory }]
  });
});

test('tool evidence requires one exact start/end pair with matching nonce', () => {
  const evidence = createSpikeEvidenceCollector('nonce-123');
  evidence.observe({ type: 'message_end', message: { content: 'margin_spike_echo nonce-123' } });
  assert.equal(evidence.snapshot().toolCalled, false);
  evidence.observe({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'margin_spike_echo',
    args: { message: 'nonce-123' }
  });
  evidence.observe({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'margin_spike_echo',
    result: { content: [{ type: 'text', text: 'nonce-123' }] },
    isError: false
  });
  assert.deepEqual(evidence.snapshot(), { toolCallCount: 1, toolCalled: true, nonceMatched: true });
});

test('report validation rejects stale evidence and configuration drift', () => {
  const now = new Date('2026-08-20T10:00:00.000Z');
  const report = {
    ok: true,
    createdAt: '2026-08-20T09:59:00.000Z',
    runId: 'run-1',
    baseline: { packageVersion: '0.84.2', license: 'MIT' },
    observed: { nodeVersion: '22.23.1', provider: 'openai', modelId: 'model-1', enabledBuiltInTools: [] },
    checks: { sessionCreated: true, inMemorySessionCreated: true, sessionRestored: true, sessionForked: true, forkParentMatched: true, compactionStarted: true, compactionEnded: true, toolCalled: true, nonceMatched: true }
  };
  assert.equal(validateSpikeReport(report, { provider: 'openai', modelId: 'model-1', now }).ok, true);
  assert.equal(validateSpikeReport(report, { provider: 'other', modelId: 'model-1', now }).ok, false);
  assert.equal(validateSpikeReport(report, { provider: 'openai', modelId: 'model-1', now: new Date('2026-08-20T11:00:00.000Z') }).ok, false);
});

test('failure classification never returns provider exception text', () => {
  const result = classifySpikeFailure(new Error('Authorization: Bearer secret-token /Users/alice/private'));
  assert.deepEqual(result, {
    exitCode: 3,
    report: { ok: false, blockedBy: 'pi_credentials_required', errorCode: 'pi_auth_unavailable' }
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-token|alice/);
});

test('spike paths stay under the explicit data directory', () => {
  const repositoryRoot = path.resolve('D:/repo');
  const paths = buildSpikePaths({
    repositoryRoot,
    dataDir: path.join(repositoryRoot, 'data', 'pi-spike')
  });
  assert.equal(paths.sessionDir, path.join(repositoryRoot, 'data', 'pi-spike', 'sessions'));
  assert.equal(paths.reportPath, path.join(repositoryRoot, 'data', 'pi-spike', 'report.json'));
});

test('spike rejects data directories outside the repository', () => {
  assert.throws(
    () => buildSpikePaths({ repositoryRoot: 'D:/repo', dataDir: 'D:/outside' }),
    /must stay inside the repository/
  );
  assert.throws(
    () => buildSpikePaths({ repositoryRoot: 'D:/repo', dataDir: 'D:/repo' }),
    /must not be the repository root/
  );
});
