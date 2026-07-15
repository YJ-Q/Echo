import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProfileSignals } from '../src/services/profileEngine.js';

test('unconfirmed growth input writes preferences but not durable growth signals', () => {
  const signals = extractProfileSignals(
    '我想学习 Node.js，但总是在开始之前拖延。',
    {
      intent: 'learning',
      emotion: 'anxious',
      tags: ['learning', 'procrastination']
    },
    { allowGrowthSignals: false }
  );
  const keys = signals.map((signal) => signal.key);

  assert.deepEqual(keys.sort(), ['echo_interaction_style', 'preferred_language']);
  assert.equal(keys.includes('current_learning_focus'), false);
  assert.equal(keys.includes('active_growth_area'), false);
  assert.equal(keys.includes('recurring_pattern'), false);
  assert.equal(keys.includes('emotional_trigger'), false);
});
