import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildGrowthSuggestion } from '../src/services/growthSuggestionEngine.js';
import * as memoryStore from '../src/storage/memoryStore.js';

test('meeting-expression struggle becomes a confirmable growth suggestion', () => {
  const suggestion = buildGrowthSuggestion({
    message: '我在会议里总是不敢完整表达，担心自己说得不够好。',
    analysis: { intent: 'chat', emotion: 'anxious', tags: ['life'] }
  });

  assert.equal(suggestion.topic, '在会议中更完整地表达');
  assert.match(suggestion.reason, /反复|担心|表达/);
  assert.match(suggestion.experiment, /下一次会议|先说完/);
  assert.match(suggestion.key, /^growth:[a-f0-9]{24}$/);
  assert.equal(suggestion.status, 'pending');
});

test('ordinary low-signal chat does not create a suggestion', () => {
  const suggestion = buildGrowthSuggestion({
    message: '今天天气不错。',
    analysis: { intent: 'chat', emotion: 'neutral', tags: ['life'] }
  });

  assert.equal(suggestion, null);
});

test('saving the same suggestion key keeps one pending record', async () => {
  await withSuggestionStore(async () => {
    const suggestion = buildGrowthSuggestion({
      message: '我在会议里总是不敢完整表达，担心自己说得不够好。',
      analysis: { intent: 'chat', emotion: 'anxious', tags: ['life'] }
    });

    const first = await memoryStore.saveGrowthSuggestion(suggestion);
    const second = await memoryStore.saveGrowthSuggestion(suggestion);
    const latest = await memoryStore.getLatestPendingGrowthSuggestion();

    assert.equal(first.key, suggestion.key);
    assert.equal(second.key, suggestion.key);
    assert.equal(latest.key, suggestion.key);
    assert.equal(latest.status, 'pending');
  });
});

test('saving a dismissed suggestion never reopens it', async () => {
  await withSuggestionStore(async () => {
    const suggestion = buildGrowthSuggestion({
      message: '我在会议里总是不敢完整表达，担心自己说得不够好。',
      analysis: { intent: 'chat', emotion: 'anxious', tags: ['life'] }
    });

    await memoryStore.saveGrowthSuggestion(suggestion);
    await memoryStore.dismissGrowthSuggestionRecord(suggestion.key);
    const savedAgain = await memoryStore.saveGrowthSuggestion(suggestion);

    assert.equal(savedAgain.status, 'dismissed');
    assert.equal(await memoryStore.getLatestPendingGrowthSuggestion(), null);
  });
});

test('confirming the same suggestion creates one learning session', async () => {
  await withSuggestionStore(async () => {
    const suggestion = buildGrowthSuggestion({
      message: '我在会议里总是不敢完整表达，担心自己说得不够好。',
      analysis: { intent: 'chat', emotion: 'anxious', tags: ['life'] }
    });
    const steps = [{ title: '先说完一个观点', action: suggestion.experiment, status: 'active' }];

    await memoryStore.saveGrowthSuggestion(suggestion);
    const first = await memoryStore.confirmGrowthSuggestionRecord(suggestion.key, steps);
    const second = await memoryStore.confirmGrowthSuggestionRecord(suggestion.key, steps);
    const sessions = await memoryStore.getLearningSessions({ limit: 10 });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.session.id, second.session.id);
    assert.equal(sessions.length, 1);
    assert.equal(second.suggestion.status, 'confirmed');
  });
});

async function withSuggestionStore(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-growth-suggestion-'));
  process.env.ECHO_DB_PATH = path.join(tempDir, 'echo.sqlite');

  try {
    await run();
  } finally {
    await memoryStore.closeMemoryStore();
    delete process.env.ECHO_DB_PATH;
    await rm(tempDir, { recursive: true, force: true });
  }
}
