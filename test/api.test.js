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
    assert.equal(stateResponse.status, 200);
    assert.equal(state.ok, true);
    assert.equal(state.data.next_action.type, 'continue_learning');
    assert.equal(state.data.current_state.focus, 'Node.js');
    assert.equal(state.data.active_learning.length, 1);
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
  } finally {
    await ctx.cleanup();
  }
});

async function startTestServer() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'echo-test-'));
  const dbPath = path.join(tempDir, 'echo.sqlite');
  process.env.ECHO_DB_PATH = dbPath;

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
