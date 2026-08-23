import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runInteractiveLoop, runTerminalLoop, sanitizePilotReport } from '../scripts/run-terminal-pilot.js';

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
  assert.match(output.join('\n'), /\/state.*\/status.*\/pause.*\/resume.*\/stop.*\/checkpoint.*\/memory.*\/new.*\/exit/s);
  assert.deepEqual(calls, ['/state', '/exit', 'close']);
  assert.equal(result.projectId, 'project-1');
});

test('sanitized report excludes prompts, credentials, and assistant text', () => {
  const report = sanitizePilotReport({
    projectId: 'project-1', sessions: ['session-1', 'session-2'], contextDigests: ['digest-1'],
    resultCodes: ['allowed'], auditIds: ['audit-1'], apiKey: 'secret', messages: ['private'], assistantText: 'private reply'
  });
  assert.deepEqual(report.sessions, ['session-1', 'session-2']);
  assert.deepEqual(report.tools, ['memory_search', 'memory_propose', 'state_update', 'action_update']);
  assert.deepEqual(report.auditIds, ['audit-1']);
  assert.doesNotMatch(JSON.stringify(report), /secret|private/);
  assert.equal(report.safety.localOnly, true);
  assert.equal(report.safety.builtinToolsDisabled, true);
});

test('interactive input is buffered while the controller is still starting', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end('/state\n/exit\n');
  const seen = [];
  const controllerPromise = new Promise((resolve) => setTimeout(() => resolve({
    async start() { return { projectId: 'p', sessionId: 's' }; },
    async handle(line) { seen.push(line); return { kind: line === '/exit' ? 'exit' : 'state', text: line }; },
    async close() {}
  }), 10));
  await runInteractiveLoop({ controllerPromise, input, output });
  assert.deepEqual(seen, ['/state', '/exit']);
});

test('SIGINT closes the controller once', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const signals = new EventEmitter();
  let closes = 0;
  const controller = { async start() { return { projectId: 'p', sessionId: 's' }; }, async handle() { return {}; }, async close() { closes += 1; } };
  const running = runInteractiveLoop({ controllerPromise: Promise.resolve(controller), input, output, signalSource: signals });
  setTimeout(() => signals.emit('SIGINT'), 10);
  await running;
  assert.equal(closes, 1);
});
