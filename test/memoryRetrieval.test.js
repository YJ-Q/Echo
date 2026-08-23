import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLexicalFeatures, rankMemoryRows } from '../src/core/memoryRetrieval.js';

const NOW = '2026-08-23T00:00:00.000Z';
const memory = (id, content, extra = {}) => ({
  id, content, confidence: 0.8, updated_at: '2026-08-22T00:00:00.000Z', ...extra
});

test('Chinese ngrams recall wording variants without inventing unrelated memory', () => {
  const rows = [
    memory('m1', '昨天完成了新版简历并优化项目经历，后续使用新版简历投递'),
    memory('m2', '周末购买咖啡')
  ];
  assert.deepEqual(rankMemoryRows(rows, { query: '继续简历投递', asOf: NOW, topK: 5 }).map((row) => row.id), ['m1']);
});

test('lexical features preserve word tokens and add two and three character Han ngrams', () => {
  const features = buildLexicalFeatures('SQLite 简历投递');
  assert.equal(features.has('sqlite'), true);
  assert.equal(features.has('简历'), true);
  assert.equal(features.has('简历投'), true);
  assert.equal(features.has('投递'), true);
});

test('lexical ranking stays deterministic and requires overlap', () => {
  const rows = [memory('b', '继续投递'), memory('a', '继续投递'), memory('x', '完全无关')];
  assert.deepEqual(rankMemoryRows(rows, { query: '继续投递', asOf: NOW, topK: 5 }).map((row) => row.id), ['a', 'b']);
});
