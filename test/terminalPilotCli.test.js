import assert from 'node:assert/strict';
import test from 'node:test';
import { runTerminalLoop, sanitizePilotReport } from '../scripts/run-terminal-pilot.js';

test('terminal loop advertises local-only scope and closes on exit', async () => {
  const output = [];
  const calls = [];
  const controller = {
    async start() { return { projectId: 'project-1', sessionId: 'session-1' }; },
    async handle(line) { calls.push(line); return line === '/exit' ? { kind: 'exit', text: '已安全退出。' } : { kind: 'state', text: '状态' }; },
    async close() { calls.push('close'); }
  };
  const result = await runTerminalLoop({ controller, lines: ['/state', '/exit'], write: (text) => output.push(text) });
  assert.match(output.join('\n'), /仅本地记录/);
  assert.match(output.join('\n'), /\/state.*\/memory.*\/new.*\/exit/s);
  assert.deepEqual(calls, ['/state', '/exit', 'close']);
  assert.equal(result.projectId, 'project-1');
});

test('sanitized report excludes prompts, credentials, and assistant text', () => {
  const report = sanitizePilotReport({
    projectId: 'project-1', sessions: ['session-1', 'session-2'], contextDigests: ['digest-1'],
    resultCodes: ['allowed'], apiKey: 'secret', messages: ['private'], assistantText: 'private reply'
  });
  assert.deepEqual(report.sessions, ['session-1', 'session-2']);
  assert.deepEqual(report.tools, ['memory_search', 'memory_propose', 'state_update', 'action_update']);
  assert.doesNotMatch(JSON.stringify(report), /secret|private/);
  assert.equal(report.safety.localOnly, true);
  assert.equal(report.safety.builtinToolsDisabled, true);
});
