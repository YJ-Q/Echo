import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { closeMemoryStore } from '../src/storage/memoryStore.js';

test('GET /state returns a stable empty-state shape', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/state?query=Node.js`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.current_state.emotion, 'neutral');
    assert.equal(data.data.next_action.type, 'open_conversation');
    assert.equal(data.data.decision.rule, 'open_conversation');
    assert.equal(data.data.explain.decision_trace.rule, 'open_conversation');
    assert.deepEqual(data.data.action_queue, []);
    assert.equal(data.data.profile.summary.profile_note, '画像还在形成，我们先不急着定义自己。');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /chat learning request creates a learning line and updates /state', async () => {
  const ctx = await startTestServer();

  try {
    const chatResponse = await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，但是总在开始前拖延。'
      })
    });
    const chat = await chatResponse.json();
    const stateResponse = await fetch(`${ctx.baseUrl}/state?query=Node.js`);
    const state = await stateResponse.json();

    assert.equal(chatResponse.status, 200);
    assert.equal(chat.ok, true);
    assert.equal(chat.data.intent, 'learning');
    assert.equal(chat.data.learning_session.topic, 'Node.js');
    assert.equal(chat.data.agent.provider, 'local');
    assert.equal(chat.data.behavior_hint.type, 'continue_learning');
    assert.equal(chat.data.decision.rule, 'continue_learning');
    assert.match(chat.data.memory_note, /Node\.js/);
    assert.ok(chat.data.insight_note.length > 0);
    assert.equal(chat.data.explanation.input_analysis.intent, 'learning');
    assert.equal(chat.data.explanation.next_action.type, 'continue_learning');
    assert.equal(stateResponse.status, 200);
    assert.equal(state.ok, true);
    assert.equal(state.data.next_action.type, 'continue_learning');
    assert.equal(state.data.current_state.focus, 'Node.js');
    assert.equal(state.data.active_learning.length, 1);
    assert.equal(state.data.explain.decision_trace.rule, 'continue_learning');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /chat returns a behavior hint aligned with state decisions', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我今天有点焦虑，一直不想开始。'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.behavior_hint);
    assert.ok(body.data.decision);
    assert.equal(body.data.behavior_hint.type, body.data.decision.rule);
    assert.equal(body.data.behavior_hint.source, body.data.decision.source);
    assert.equal(body.data.explanation.next_action.type, body.data.decision.rule);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /summary is idempotent per day', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我今天有点焦虑，还没开始做任务。'
      })
    });

    const first = await fetch(`${ctx.baseUrl}/summary`, { method: 'POST' });
    const second = await fetch(`${ctx.baseUrl}/summary`, { method: 'POST' });
    const recent = await fetch(`${ctx.baseUrl}/summary/recent?limit=10`);
    const firstBody = await first.json();
    const secondBody = await second.json();
    const recentBody = await recent.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.ok, true);
    assert.equal(secondBody.ok, true);
    assert.equal(firstBody.data.date, secondBody.data.date);
    assert.equal(recentBody.data.summaries.length, 1);
    assert.equal(recentBody.data.summaries[0].date, firstBody.data.date);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/suggested deduplicates the same pending suggestion', async () => {
  const ctx = await startTestServer();

  try {
    const first = await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Node.js' })
    });
    const second = await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Node.js' })
    });
    const actions = await fetch(`${ctx.baseUrl}/actions`);
    const firstBody = await first.json();
    const secondBody = await second.json();
    const actionsBody = await actions.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(firstBody.ok, true);
    assert.equal(secondBody.ok, true);
    assert.equal(firstBody.data.action.id, secondBody.data.action.id);
    assert.equal(actionsBody.data.actions.length, 1);
    assert.equal(firstBody.data.action.metadata.decision_source, 'conversation_opening');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /memory/context returns layered memory injection context', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，但我总在开始前拖延。'
      })
    });

    await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Node.js' })
    });

    const response = await fetch(`${ctx.baseUrl}/memory/context?query=Node.js`);
    const body = await response.json();
    const { context } = body.data;

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(context.injection.layers.learning.focus, 'Node.js');
    assert.equal(context.injection.layers.pattern.recurring_pattern, 'procrastination around starting tasks');
    assert.equal(context.injection.layers.action.pending_action.title, '继续：说清 Node.js 是什么');
    assert.match(context.injection.prompt_context, /Node\.js/);
    assert.match(context.summary.latest_memory_note, /Node\.js/);
    assert.ok(context.summary.insight_trail.length > 0);
    assert.ok(context.summary.priority_overview.core.length > 0);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /memory includes distilled memory notes, insights, and priority metadata', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我今天一直拖延，不想开始写代码。'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const body = await response.json();
    const memory = body.data.memories[0];

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(memory.memory_note.length > 0);
    assert.ok(memory.insight_note.length > 0);
    assert.ok(memory.salience >= 0.2);
    assert.ok(memory.reinforcement_count >= 1);
    assert.ok(['ambient', 'important', 'core'].includes(memory.priority_bucket));
  } finally {
    await ctx.cleanup();
  }
});

test('relevant memory access reinforces long-term memory weight', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，而且这件事最近反复出现。'
      })
    });

    const firstMemory = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const firstBody = await firstMemory.json();
    const before = firstBody.data.memories[0].reinforcement_count;

    await fetch(`${ctx.baseUrl}/memory/context?query=Node.js`);

    const secondMemory = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const secondBody = await secondMemory.json();
    const after = secondBody.data.memories[0].reinforcement_count;

    assert.ok(after > before);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /memory/profile/refresh synthesizes long-term profile notes', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学 Node.js，但是总在开始前拖延。' })
    });
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我还是想学 Node.js，但总在真正开始前犹豫。' })
    });
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '今天一想到任务我就焦虑，但还是想继续学 Node.js。' })
    });

    const response = await fetch(`${ctx.baseUrl}/memory/profile/refresh`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.synthesis.signals.length > 0);
    assert.ok(body.data.summary.long_term_notes.length > 0);
    assert.equal(body.data.summary.sustained_learning_topic, 'Node.js');
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration can override profile and pin memory', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我总在开始前拖延，但也确实想继续学 Node.js。' })
    });

    const memoriesResponse = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const memoriesBody = await memoriesResponse.json();
    const memoryId = memoriesBody.data.memories[0].id;

    const profileOverride = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'current_learning_focus',
        value: 'Deep Work',
        confidence: 0.95
      })
    });
    const pinResponse = await fetch(`${ctx.baseUrl}/memory/${memoryId}/pin`, {
      method: 'POST'
    });
    const snapshotResponse = await fetch(`${ctx.baseUrl}/memory/calibration`);
    const overrideBody = await profileOverride.json();
    const pinBody = await pinResponse.json();
    const snapshotBody = await snapshotResponse.json();

    assert.equal(profileOverride.status, 200);
    assert.equal(pinResponse.status, 200);
    assert.equal(snapshotResponse.status, 200);
    assert.equal(overrideBody.data.summary.current_learning_focus, 'Deep Work');
    assert.equal(pinBody.data.memory.pinned, true);
    assert.equal(pinBody.data.memory.priority_bucket, 'core');
    assert.ok(snapshotBody.data.pinned_memories.length >= 1);
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration can adjust memory priority metadata', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我今天不想开始，但这个片段没那么重要。' })
    });

    const memoriesResponse = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const memoriesBody = await memoriesResponse.json();
    const memoryId = memoriesBody.data.memories[0].id;

    const response = await fetch(`${ctx.baseUrl}/memory/${memoryId}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salience: 0.22,
        priority_bucket: 'ambient',
        pinned: false,
        reinforcement_count: 2
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.memory.priority_bucket, 'ambient');
    assert.equal(body.data.memory.pinned, false);
    assert.equal(body.data.memory.reinforcement_count, 2);
    assert.equal(body.data.memory.salience, 0.22);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state prefers resuming an existing pending echo action when no active learning exists', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'start_small',
        title: '先做 5 分钟',
        detail: '打开编辑器，只写第一行。',
        source: 'echo_state'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/state?query=writing`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.next_action.type, 'resume_pending_action');
    assert.equal(body.data.decision.source, 'pending_action_queue');
  } finally {
    await ctx.cleanup();
  }
});

async function startTestServer() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'echo-test-'));
  const dbPath = path.join(tempDir, 'echo.sqlite');
  process.env.ECHO_DB_PATH = dbPath;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ECHO_LLM_PROVIDER;

  const app = await createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async cleanup() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await closeMemoryStore();
      delete process.env.ECHO_DB_PATH;
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}
