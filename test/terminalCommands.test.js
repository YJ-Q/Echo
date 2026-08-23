import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMemory, formatState, parseTerminalInput } from '../src/pilot/terminalCommands.js';

test('parseTerminalInput recognizes the closed command set and messages', () => {
  assert.deepEqual(parseTerminalInput('  /state  '), { type: 'command', name: 'state' });
  assert.deepEqual(parseTerminalInput('/memory'), { type: 'command', name: 'memory' });
  assert.deepEqual(parseTerminalInput('/new'), { type: 'command', name: 'new' });
  assert.deepEqual(parseTerminalInput('/exit'), { type: 'command', name: 'exit' });
  assert.deepEqual(parseTerminalInput('/confirm-memory memory-1 2'), { type: 'command', name: 'confirm-memory', args: ['memory-1', '2'] });
  assert.deepEqual(parseTerminalInput('/delete'), { type: 'unknown_command', name: 'delete' });
  assert.deepEqual(parseTerminalInput('   '), { type: 'empty' });
  assert.deepEqual(parseTerminalInput('  今天投递了示例公司  '), { type: 'message', text: '今天投递了示例公司' });
});

test('formatState exposes identifiers and versions without dumping objects', () => {
  const text = formatState({
    project: { id: 'project-1', version: 2, goal: '持续投递', phase: 'pilot', status: 'active' },
    tasks: [{ id: 'task-1', version: 3, title: '整理投递', current_step: '投递 A', blocker: null }],
    actions: [{ id: 'action-1', version: 1, title: '投递 A', status: 'pending', due_at: null }]
  });
  assert.match(text, /project-1.*v2/s);
  assert.match(text, /task-1.*v3/s);
  assert.match(text, /action-1.*v1/s);
  assert.doesNotMatch(text, /\[object Object\]/);
});

test('formatMemory reports provenance and an explicit empty recall', () => {
  assert.equal(formatMemory({ selected: [] }), '未召回相关内容');
  const text = formatMemory({ selected: [{
    entityType: 'memory', entityId: 'memory-1', version: 2,
    sourceSessionId: 'session-a', reason: 'confirmed_memory', content: '偏好远程岗位', confirmationStatus: 'confirmed'
  }] });
  assert.match(text, /memory-1.*v2/s);
  assert.match(text, /session-a/);
  assert.match(text, /confirmed_memory/);
  assert.match(text, /confirmed/);
});
