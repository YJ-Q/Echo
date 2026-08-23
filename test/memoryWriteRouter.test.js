import assert from 'node:assert/strict';
import test from 'node:test';
import { routeContinuityInput } from '../src/continuity/memoryWriteRouter.js';

test('ordinary acknowledgements and chat stay out of durable state', () => {
  assert.deepEqual(routeContinuityInput('好的，谢谢').routes, ['ignore']);
  assert.deepEqual(routeContinuityInput('今天天气不错').routes, ['ignore']);
});

test('one progress message can route to state, action, and a memory proposal', () => {
  const result = routeContinuityInput('昨天完成了新版简历，今天准备投递；以后都使用这个版本');
  assert.deepEqual(result.routes, ['state', 'action', 'memory_proposal']);
  assert.deepEqual(result.reasons, ['progress_signal', 'next_step_signal', 'durable_signal']);
});

test('blockers route to state and explicit remembering routes to a proposal', () => {
  assert.deepEqual(routeContinuityInput('目前卡在岗位筛选').routes, ['state']);
  assert.deepEqual(routeContinuityInput('请记住我长期只考虑上海的岗位').routes, ['memory_proposal']);
});

test('router never extracts or converts approximate quantities', () => {
  const result = routeContinuityInput('昨天梳理了十几家到二十几家公司，准备今天投递');
  assert.deepEqual(result.routes, ['state', 'action']);
  assert.equal(JSON.stringify(result).includes('20'), false);
});
