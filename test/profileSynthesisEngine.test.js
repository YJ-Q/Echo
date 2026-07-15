import test from 'node:test';
import assert from 'node:assert/strict';
import * as profileSynthesis from '../src/services/profileSynthesisEngine.js';

const { buildSynthesisSignals } = profileSynthesis;

function createMemory({
  user_input,
  emotion = 'neutral',
  tags = []
}) {
  return {
    user_input,
    emotion,
    tags
  };
}

test('buildSynthesisSignals does not write sustained topic for split learning themes', () => {
  const signals = buildSynthesisSignals([
    createMemory({ user_input: 'I want to learn Node.js', tags: ['learning'], emotion: 'motivated' }),
    createMemory({ user_input: 'I still want to learn Node.js', tags: ['learning'], emotion: 'motivated' }),
    createMemory({ user_input: 'I want to learn Python next', tags: ['learning'], emotion: 'neutral' }),
    createMemory({ user_input: 'I also want to learn Python for work', tags: ['learning'], emotion: 'neutral' })
  ]);

  assert.equal(signals.find((signal) => signal.key === 'sustained_learning_topic'), undefined);
});

test('buildSynthesisSignals writes sustained topic for repeated majority learning theme', () => {
  const signals = buildSynthesisSignals([
    createMemory({ user_input: 'I want to learn Node.js', tags: ['learning'], emotion: 'motivated' }),
    createMemory({ user_input: 'I still want to learn Node.js', tags: ['learning', 'procrastination'], emotion: 'distracted' }),
    createMemory({ user_input: 'teach me Python sometime later', tags: ['learning'], emotion: 'neutral' })
  ]);

  assert.deepEqual(signals.find((signal) => signal.key === 'sustained_learning_topic'), {
    key: 'sustained_learning_topic',
    value: 'Node.js',
    confidence: 0.68
  });
});

test('sustained learning topic requires a user-confirmed matching session', () => {
  const signals = [{
    key: 'sustained_learning_topic',
    value: 'Node.js',
    confidence: 0.68
  }];

  assert.deepEqual(profileSynthesis.filterConfirmedGrowthSignals(signals, []), []);
  assert.deepEqual(
    profileSynthesis.filterConfirmedGrowthSignals(signals, [{ topic: 'Node.js' }]),
    signals
  );
});

test('buildSynthesisSignals avoids early emotional baseline and recovery path from sparse signals', () => {
  const signals = buildSynthesisSignals([
    createMemory({ user_input: 'I feel anxious about starting', tags: ['procrastination'], emotion: 'anxious' }),
    createMemory({ user_input: 'Still anxious and avoiding the task', tags: ['procrastination'], emotion: 'anxious' }),
    createMemory({ user_input: 'I do want to learn Node.js though', tags: ['learning'], emotion: 'motivated' })
  ]);

  assert.equal(signals.find((signal) => signal.key === 'emotional_baseline'), undefined);
  assert.equal(signals.find((signal) => signal.key === 'recovery_path'), undefined);
});

test('buildSynthesisSignals writes emotional and recovery signals only after stable repetition', () => {
  const signals = buildSynthesisSignals([
    createMemory({ user_input: 'I feel anxious before starting today', tags: ['mood'], emotion: 'anxious' }),
    createMemory({ user_input: 'The same future pressure is back', tags: ['mood'], emotion: 'anxious' }),
    createMemory({ user_input: 'I am anxious again, so I need one visible step', tags: ['planning'], emotion: 'anxious' }),
    createMemory({ user_input: 'I wrote one small next step', tags: ['planning'], emotion: 'neutral' })
  ]);

  assert.deepEqual(signals.find((signal) => signal.key === 'emotional_baseline'), {
    key: 'emotional_baseline',
    value: 'anxious',
    confidence: 0.66
  });
  assert.deepEqual(signals.find((signal) => signal.key === 'recovery_path'), {
    key: 'recovery_path',
    value: 'ground into one visible next step',
    confidence: 0.64
  });
});
