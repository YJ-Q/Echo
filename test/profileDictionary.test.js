import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfileKeyDefinition,
  humanizeProfileValue,
  isKnownProfileKey
} from '../src/services/profileDictionary.js';
import { summarizeProfile } from '../src/services/profileEngine.js';

test('known profile key returns label and category metadata', () => {
  const definition = getProfileKeyDefinition('emotional_baseline');

  assert.equal(definition.label, '情绪底色');
  assert.equal(definition.category, 'emotion');
  assert.equal(definition.includeInSummary, true);
  assert.equal(definition.known, true);
  assert.equal(isKnownProfileKey('emotional_baseline'), true);
});

test('unknown profile key falls back to stable custom metadata', () => {
  const definition = getProfileKeyDefinition('manual_focus_default');

  assert.equal(definition.key, 'manual_focus_default');
  assert.equal(definition.label, 'manual_focus_default');
  assert.equal(definition.category, 'custom');
  assert.equal(definition.includeInSummary, false);
  assert.equal(definition.includeInProfileNote, false);
  assert.equal(definition.known, false);
  assert.equal(isKnownProfileKey('manual_focus_default'), false);
});

test('humanizeProfileValue maps known values and preserves unknown values', () => {
  assert.equal(humanizeProfileValue('anxious'), '焦虑');
  assert.equal(
    humanizeProfileValue('returns through small executable learning steps'),
    '通过小而可执行的学习动作，更容易重新进入状态'
  );
  assert.equal(humanizeProfileValue('Deep Work'), 'Deep Work');
});

test('summarizeProfile keeps current fields and human-readable values', () => {
  const summary = summarizeProfile([
    { key: 'preferred_language', value: 'zh-CN', confidence: 0.7, updated_at: '2026-07-08T00:00:00.000Z' },
    { key: 'recurring_pattern', value: 'procrastination around starting tasks', confidence: 0.7, updated_at: '2026-07-08T00:00:00.000Z' },
    { key: 'emotional_baseline', value: 'anxious', confidence: 0.66, updated_at: '2026-07-08T00:00:00.000Z' },
    { key: 'manual_focus_default', value: 'Deep Work', confidence: 0.5, updated_at: '2026-07-08T00:00:00.000Z' }
  ]);
  const recurringPatternSignal = summary.stable_signals.find((entry) => entry.key === 'recurring_pattern');
  const manualSignal = summary.developing_signals.find((entry) => entry.key === 'manual_focus_default');

  assert.equal(summary.preferred_language, 'zh-CN');
  assert.equal(summary.recurring_pattern, '启动任务前的拖延');
  assert.equal(summary.emotional_baseline, '焦虑');
  assert.equal(recurringPatternSignal?.value, '启动任务前的拖延');
  assert.equal(manualSignal?.key, 'manual_focus_default');
  assert.equal(manualSignal?.value, 'Deep Work');
  assert.ok(Object.hasOwn(summary, 'profile_note'));
  assert.ok(Object.hasOwn(summary, 'long_term_notes'));
});
