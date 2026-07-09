import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateDailySummary } from '../src/services/reflectionEngine.js';
import { prepareLearningSession, assessLearningProgress } from '../src/services/learningEngine.js';
import { addMemory, closeMemoryStore } from '../src/storage/memoryStore.js';

test('generateDailySummary keeps the empty-day fallback stable and idempotent', async () => {
  await withReflectionStore(async () => {
    const date = new Date();

    const first = await generateDailySummary(date);
    const second = await generateDailySummary(date);

    assert.deepEqual(first, second);
    assert.equal(first.date, date.toISOString().slice(0, 10));
    assert.equal(first.emotional_trend, 'neutral');
    assert.equal(first.summary, '今天还没有留下足够的回声。');
    assert.equal(first.behavioral_pattern, '还没有足够记录形成模式。');
    assert.equal(first.echo_reflection, '空白不是失败，只是还没有被看见。');
  });
});

test('generateDailySummary uses gentler narrative wording when learning is present but not yet executed', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I want to pick Node.js back up.',
      echo_response: 'Let us bring that learning thread back into view.',
      emotion: 'focused',
      tags: ['learning'],
      memory_note: 'Node.js returned to the center of attention today.',
      insight_note: 'The learning intent is back, but action has not started yet.'
    });
    await prepareLearningSession('I want to learn Node.js');

    const summary = await generateDailySummary(new Date());

    assert.match(summary.summary, /“学习”/u);
    assert.match(summary.summary, /Node\.js/u);
    assert.match(summary.summary, /行动还停在起步处/u);
    assert.match(summary.summary, /“专注”/u);
    assert.match(summary.behavioral_pattern, /靠近学习/u);
    assert.match(summary.behavioral_pattern, /没有形成可见行动/u);
    assert.doesNotMatch(summary.summary, /今日主线|学习状态|0 次/u);
  });
});

test('generateDailySummary describes friction and recovery without reducing the day to counters', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I am learning JavaScript. I feel anxious, but I still want to continue.',
      echo_response: 'Let us name the stuck point and keep moving.',
      emotion: 'anxious',
      tags: ['learning', 'planning'],
      memory_note: 'There was both momentum and resistance around JavaScript today.',
      insight_note: 'The resistance is starting to become concrete.'
    });

    await prepareLearningSession('I want to learn JavaScript');
    await assessLearningProgress('I tried a JavaScript closures demo and it is not fully working yet.');
    await assessLearningProgress("I'm stuck on JavaScript closures.");
    await assessLearningProgress('I finished the JavaScript explanation step.');

    const summary = await generateDailySummary(new Date());

    assert.match(summary.summary, /“学习”/u);
    assert.match(summary.summary, /JavaScript/u);
    assert.match(summary.summary, /完成了 1 步/u);
    assert.match(summary.summary, /1 处阻力/u);
    assert.match(summary.summary, /“焦虑”/u);
    assert.match(summary.behavioral_pattern, /具体阻力/u);
    assert.match(summary.behavioral_pattern, /没有离开学习线/u);
    assert.match(summary.echo_reflection, /被卡住后还留在/u);
    assert.match(summary.echo_reflection, /JavaScript/u);
    assert.doesNotMatch(summary.summary, /今日主线|学习状态/u);
    assert.doesNotMatch(summary.summary, /推进 \d+ 次，尝试 \d+ 次，卡住 \d+ 次/u);
    assert.doesNotMatch(summary.echo_reflection, /失败/u);
  });
});

test('generateDailySummary recognizes planning without action as planning drift instead of learning progress', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I spent the day planning tomorrow, but I still did not start.',
      echo_response: 'Let us catch the first action hiding inside the plan.',
      emotion: 'focused',
      tags: ['planning'],
      memory_note: 'Today stayed mostly at the planning layer.',
      insight_note: 'The plan is clear, but execution has not started yet.'
    });

    const summary = await generateDailySummary(new Date());

    assert.equal(summary.emotional_trend, 'focused');
    assert.match(summary.summary, /“计划”/u);
    assert.match(summary.behavioral_pattern, /计划层/u);
    assert.match(summary.behavioral_pattern, /行动层/u);
    assert.match(summary.echo_reflection, /计划当成了行动的替身/u);
    assert.doesNotMatch(summary.summary, /0 次/u);
    assert.doesNotMatch(summary.behavioral_pattern, /学习/u);
  });
});

test('generateDailySummary keeps start-line procrastination focused on the entry point', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I know the direction, but I keep stalling before the first step.',
      echo_response: 'Shrink the doorway until it is small enough to cross.',
      emotion: 'distracted',
      tags: ['procrastination'],
      memory_note: 'Today the procrastination showed up before starting.',
      insight_note: 'The resistance sits at the doorway, not in the middle of the work.'
    });

    const summary = await generateDailySummary(new Date());

    assert.equal(summary.emotional_trend, 'distracted');
    assert.match(summary.summary, /“拖延”/u);
    assert.match(summary.behavioral_pattern, /开始之前/u);
    assert.match(summary.echo_reflection, /入口处/u);
    assert.match(summary.echo_reflection, /缩小/u);
    assert.doesNotMatch(summary.echo_reflection, /失败/u);
  });
});

test('generateDailySummary frames future pressure as borrowed worry instead of execution failure', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I spent today worrying about next week before it even arrived.',
      echo_response: 'Give tomorrow back to tomorrow first.',
      emotion: 'anxious',
      tags: ['mood'],
      memory_note: 'Today was pulled by things that have not happened yet.',
      insight_note: 'Future pressure arrived earlier than it needed to.'
    });

    const summary = await generateDailySummary(new Date());

    assert.equal(summary.emotional_trend, 'anxious');
    assert.match(summary.behavioral_pattern, /未来压力/u);
    assert.match(summary.echo_reflection, /尚未发生/u);
    assert.match(summary.echo_reflection, /明天还给明天/u);
    assert.doesNotMatch(summary.summary, /0 次/u);
  });
});

test('generateDailySummary captures a closed learning loop once a step is actually completed', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I want to learn JavaScript.',
      echo_response: 'Let us make it concrete.',
      emotion: 'motivated',
      tags: ['learning'],
      memory_note: 'Today JavaScript came back into focus.',
      insight_note: 'There is a clear learning intent.'
    });

    await prepareLearningSession('I want to learn JavaScript.');
    const progress = await assessLearningProgress('I finished the JavaScript closures demo.');

    assert.equal(progress?.status, 'complete');

    const summary = await generateDailySummary(new Date());

    assert.equal(summary.emotional_trend, 'motivated');
    assert.match(summary.summary, /JavaScript/u);
    assert.match(summary.summary, /完成了 1 步/u);
    assert.match(summary.behavioral_pattern, /完成闭环/u);
    assert.match(summary.echo_reflection, /小闭环/u);
    assert.doesNotMatch(summary.behavioral_pattern, /可见行动/u);
  });
});

test('generateDailySummary keeps a stuck day specific and avoids narrating it as personal failure', async () => {
  await withReflectionStore(async () => {
    await addMemory({
      timestamp: new Date().toISOString(),
      user_input: 'I want to learn JavaScript, but I am anxious about closures.',
      echo_response: 'Name the obstacle first.',
      emotion: 'anxious',
      tags: ['learning'],
      memory_note: 'Today the friction became concrete.',
      insight_note: 'The obstacle is specific enough to describe.'
    });

    await prepareLearningSession('I want to learn JavaScript.');
    const progress = await assessLearningProgress("I'm stuck on JavaScript closures.");

    assert.equal(progress?.status, 'stuck');

    const summary = await generateDailySummary(new Date());

    assert.equal(summary.emotional_trend, 'anxious');
    assert.match(summary.summary, /具体卡点/u);
    assert.match(summary.behavioral_pattern, /具体卡点/u);
    assert.match(summary.echo_reflection, /不是落在整个自己身上/u);
    assert.doesNotMatch(summary.echo_reflection, /失败|做不到/u);
  });
});

async function withReflectionStore(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'echo-reflection-test-'));
  process.env.ECHO_DB_PATH = path.join(tempDir, 'echo.sqlite');

  try {
    await run();
  } finally {
    await closeMemoryStore();
    delete process.env.ECHO_DB_PATH;
    await rm(tempDir, { recursive: true, force: true });
  }
}
