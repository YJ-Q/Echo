import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertSafeLiveEvidence, sanitizeLiveEvidence } from '../scripts/run-phase2b-live-e2e.js';

function safeEvidence() {
  return {
    status: 'passed', piVersion: '0.84.2', contractVersion: '1.0',
    workstreamId: 'margin-workstream-id', runId: 'margin-run-id',
    workstreamVersion: 2, runVersion: 3, beforeCursor: 2, afterCursor: 4,
    resultCodes: ['allowed']
  };
}

test('live evidence accepts only Margin ids, stable codes, versions, cursors, and final status', () => {
  const evidence = assertSafeLiveEvidence(safeEvidence());
  assert.deepEqual(evidence, safeEvidence());
  assert.equal(Object.isFrozen(evidence), true);
});
test('live evidence recursively rejects forbidden keys and credential-like values', () => {
  for (const key of ['prompt', 'message', 'assistant', 'text', 'reasoning', 'session', 'token', 'apiKey', 'stack']) {
    assert.throws(() => assertSafeLiveEvidence({ ...safeEvidence(), detail: { [key]: 'private' } }), /unsafe_live_evidence/u, key);
  }
  for (const value of ['Bearer abcdefghijklmnop', 'sk-abcdefghijklmnopqrstuvwxyz123456', 'YAPI_API_KEY=private-value']) {
    assert.throws(() => assertSafeLiveEvidence({ ...safeEvidence(), resultCodes: [value] }), /unsafe_live_evidence/u, value);
  }
});

test('sanitizer drops runtime/model material before the recursive guard', () => {
  const evidence = sanitizeLiveEvidence({
    ...safeEvidence(), prompt: 'private input', assistantText: 'private output',
    runtime: { sessionId: 'private-session' }, apiKey: 'private-key'
  });
  assert.deepEqual(evidence, safeEvidence());
  assert.doesNotMatch(JSON.stringify(evidence), /private|prompt|assistant|session|apiKey/iu);
});

test('live runner is pinned to Pi 0.84.2 and writes only beneath ignored phase2b-live data', async () => {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const source = await readFile(path.resolve('scripts/run-phase2b-live-e2e.js'), 'utf8');
  const gitignore = await readFile(path.resolve('.gitignore'), 'utf8');
  assert.equal(packageJson.dependencies['@earendil-works/pi-coding-agent'], '0.84.2');
  assert.match(source, /data['"],\s*['"]phase2b-live/u);
  assert.match(gitignore, /data\/\*\*\/\*\.json/u);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:apiKey|YAPI_API_KEY)/u);
});
