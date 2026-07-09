import test from 'node:test';
import assert from 'node:assert/strict';
import { clampConfidence, mergeProfileSignal } from '../src/services/profileMergeEngine.js';

test('mergeProfileSignal writes incoming value when no existing profile is present', () => {
  const merged = mergeProfileSignal(null, {
    value: 'Deep Work',
    confidence: 5
  });

  assert.deepEqual(merged, {
    value: 'Deep Work',
    confidence: 1
  });
});

test('mergeProfileSignal reinforces confidence when the value stays the same', () => {
  const merged = mergeProfileSignal(
    { value: 'Node.js', confidence: 0.61 },
    { value: 'Node.js', confidence: 0.58 }
  );

  assert.deepEqual(merged, {
    value: 'Node.js',
    confidence: 0.69
  });
});

test('mergeProfileSignal keeps a high-confidence existing value against a weaker conflicting signal', () => {
  const merged = mergeProfileSignal(
    { value: 'Deep Work', confidence: 0.95 },
    { value: 'Node.js', confidence: 0.6 }
  );

  assert.deepEqual(merged, {
    value: 'Deep Work',
    confidence: 0.95
  });
});

test('mergeProfileSignal allows a clearly stronger conflicting signal to replace the value', () => {
  const merged = mergeProfileSignal(
    { value: 'Deep Work', confidence: 0.74 },
    { value: 'Node.js', confidence: 0.93 }
  );

  assert.deepEqual(merged, {
    value: 'Node.js',
    confidence: 0.93
  });
});

test('mergeProfileSignal keeps the existing value for ambiguous conflicting signals', () => {
  const merged = mergeProfileSignal(
    { value: 'Deep Work', confidence: 0.72 },
    { value: 'Node.js', confidence: 0.75 }
  );

  assert.deepEqual(merged, {
    value: 'Deep Work',
    confidence: 0.72
  });
});

test('mergeProfileSignal allows forced manual overrides to replace a high-confidence value', () => {
  const merged = mergeProfileSignal(
    { value: 'Deep Work', confidence: 0.95 },
    { value: 'Node.js', confidence: 0.92, force: true }
  );

  assert.deepEqual(merged, {
    value: 'Node.js',
    confidence: 0.92
  });
});

test('clampConfidence keeps profile confidence within the supported range', () => {
  assert.equal(clampConfidence(-2), 0.1);
  assert.equal(clampConfidence(0), 0.1);
  assert.equal(clampConfidence(0.42), 0.42);
  assert.equal(clampConfidence(2), 1);
});
