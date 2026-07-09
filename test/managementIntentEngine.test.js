import test from 'node:test';
import assert from 'node:assert/strict';
import { detectManagementIntent } from '../src/services/managementIntentEngine.js';

test('detectManagementIntent recognizes memory cleanup requests', () => {
  const result = detectManagementIntent('帮我清理一下旧的记忆存档，删除冗余的部分');

  assert.equal(result.is_management, true);
  assert.equal(result.primary_scope, 'memory');
  assert.equal(result.scopes.includes('memory'), true);
  assert.equal(result.risk_level, 'destructive');
});

test('detectManagementIntent recognizes learning line review requests', () => {
  const result = detectManagementIntent('你帮我梳理一下当前的学习线路，我们一起讨论修改或者删除');

  assert.equal(result.is_management, true);
  assert.equal(result.primary_scope, 'learning');
  assert.equal(result.scopes.includes('learning'), true);
});

test('detectManagementIntent does not classify ordinary chat as management', () => {
  const result = detectManagementIntent('我今天有点累，想先聊聊');

  assert.equal(result.is_management, false);
  assert.deepEqual(result.scopes, []);
});

