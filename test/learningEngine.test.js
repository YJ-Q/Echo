import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assessLearningProgress,
  isLearningRelatedMessage,
  prepareLearningSession
} from '../src/services/learningEngine.js';
import {
  closeMemoryStore,
  getLearningEvents,
  getLearningSessions,
  updateLearningStep
} from '../src/storage/memoryStore.js';

test('learning relevance gating ignores unrelated casual chat during an active session', async () => {
  await withLearningStore(async () => {
    await prepareLearningSession('我想学 JavaScript');

    const progress = await assessLearningProgress('我今天有点累，只想聊聊');
    const events = await getLearningEvents({ limit: 10 });
    const sessions = await getLearningSessions({ status: 'active', limit: 1 });

    assert.equal(progress, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'session_created');
    assert.equal(sessions[0].current_step, 0);
  });
});

test('learning relevance gating ignores short acknowledgements', async () => {
  await withLearningStore(async () => {
    await prepareLearningSession('我想学 JavaScript');

    const progress = await assessLearningProgress('嗯');
    const events = await getLearningEvents({ limit: 10 });

    assert.equal(progress, null);
    assert.equal(events.length, 1);
  });
});

test('learning progress can still classify a concrete stuck point', async () => {
  await withLearningStore(async () => {
    await prepareLearningSession('我想学 JavaScript');

    const progress = await assessLearningProgress('我不懂闭包');
    const events = await getLearningEvents({ limit: 10 });

    assert.equal(progress.status, 'stuck');
    assert.equal(progress.message, 'explicit_stuck');
    assert.equal(events[0].event_type, 'step_stuck');
    assert.equal(events[0].step_index, 0);
    assert.equal(events[0].step_title, '说清 JavaScript 是什么');
    assert.match(events[0].note, /automatic progress assessment/);
    assert.match(events[0].note, /explicit_stuck/);
    assert.equal(events[0].user_input, '我不懂闭包');
  });
});

test('learning progress keeps substantive learning work as partial', async () => {
  await withLearningStore(async () => {
    await prepareLearningSession('我想学 JavaScript');

    const progress = await assessLearningProgress('我写了一个 demo，但是还没完全跑通。');

    assert.equal(progress.status, 'partial');
    assert.equal(progress.message, 'substantive_reply');
  });
});

test('completing the final step marks the learning session completed', async () => {
  await withLearningStore(async () => {
    const created = await prepareLearningSession('我想学 JavaScript');

    await updateLearningStep(created.session.id, 0, 'done');
    await updateLearningStep(created.session.id, 1, 'done');
    await updateLearningStep(created.session.id, 2, 'done');

    const progress = await assessLearningProgress('我已经复述了笔记，完成了。');
    const completed = await getLearningSessions({ status: 'completed', limit: 1 });
    const active = await getLearningSessions({ status: 'active', limit: 1 });
    const afterCompletionProgress = await assessLearningProgress('我又写了一点 JavaScript 笔记。');

    assert.equal(progress.status, 'complete');
    assert.equal(progress.session.status, 'completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].current_step, 3);
    assert.equal(active.length, 0);
    assert.equal(afterCompletionProgress, null);
  });
});

test('manual learning step updates reject out-of-range indexes without writing events', async () => {
  await withLearningStore(async () => {
    const created = await prepareLearningSession('我想学 JavaScript');

    await assert.rejects(
      () => updateLearningStep(created.session.id, 99, 'done'),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, 'learning_step_out_of_range');
        return true;
      }
    );

    const events = await getLearningEvents({ limit: 10 });
    const sessions = await getLearningSessions({ status: 'active', limit: 1 });

    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'session_created');
    assert.equal(sessions[0].current_step, 0);
    assert.equal(sessions[0].steps[0].status, 'active');
  });
});

test('isLearningRelatedMessage requires more than a bare completion keyword', async () => {
  const session = {
    topic: 'JavaScript',
    current_step: 0,
    steps: [
      {
        title: '说清 JavaScript 是什么',
        action: '用一句话写下：JavaScript 解决什么问题。',
        status: 'active'
      }
    ]
  };

  assert.equal(isLearningRelatedMessage('完成了', session), false);
  assert.equal(isLearningRelatedMessage('我写完了 JavaScript 的小例子', session), true);
});

async function withLearningStore(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'echo-learning-test-'));
  process.env.ECHO_DB_PATH = path.join(tempDir, 'echo.sqlite');

  try {
    await run();
  } finally {
    await closeMemoryStore();
    delete process.env.ECHO_DB_PATH;
    await rm(tempDir, { recursive: true, force: true });
  }
}
