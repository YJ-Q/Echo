import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { closeMemoryStore } from '../src/storage/memoryStore.js';

const STORY = '我在会议里总是不敢完整表达，担心自己说得不够好。';
const TOPIC = '在会议中更完整地表达';
const RESULT = '我先说完了一个观点，没有在中途自我否定。';

test('core growth story survives confirmation, duplicate actions, and restart', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-core-beta-'));
  const dbPath = path.join(tempDir, 'margin.sqlite');
  let running = null;

  try {
    running = await startPersistentServer(dbPath);
    const reflect = await postJson(running.baseUrl, '/api/reflect', { message: STORY });
    const suggestion = reflect.result?.growth_suggestion;
    assert.ok(suggestion?.key);
    assert.equal(suggestion.topic, TOPIC);

    const beforeConfirmation = await getJson(running.baseUrl, '/learning/active');
    assert.equal(beforeConfirmation.sessions.length, 0);

    const confirmationPath = `/learning/suggestions/${encodeURIComponent(suggestion.key)}/confirm`;
    const firstConfirmation = await postJson(running.baseUrl, confirmationPath, {});
    const secondConfirmation = await postJson(running.baseUrl, confirmationPath, {});
    assert.equal(firstConfirmation.session.id, secondConfirmation.session.id);
    assert.equal(secondConfirmation.already_confirmed, true);

    const stepPath = `/learning/${firstConfirmation.session.id}/steps/0`;
    const firstCompletion = await postJson(running.baseUrl, stepPath, { status: 'done', result: RESULT });
    const secondCompletion = await postJson(running.baseUrl, stepPath, { status: 'done', result: RESULT });
    assert.equal(firstCompletion.already_applied, false);
    assert.equal(secondCompletion.already_applied, true);

    const beforeRestart = await readExperience(running.baseUrl, firstConfirmation.session.id);
    assertExperience(beforeRestart);

    await running.stop();
    running = await startPersistentServer(dbPath);

    const afterRestart = await readExperience(running.baseUrl, firstConfirmation.session.id);
    assertExperience(afterRestart);
    assert.deepEqual(
      afterRestart.memory.growth_records.map((record) => record.text),
      beforeRestart.memory.growth_records.map((record) => record.text)
    );
  } finally {
    if (running) await running.stop();
    await closeMemoryStore();
    delete process.env.ECHO_DB_PATH;
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function readExperience(baseUrl, sessionId) {
  const [learning, events, memory, profile, achievements] = await Promise.all([
    getJson(baseUrl, '/learning/active'),
    getJson(baseUrl, `/learning/events?sessionId=${sessionId}`),
    getJson(baseUrl, '/memory'),
    getJson(baseUrl, '/memory/profile'),
    getJson(baseUrl, '/achievements'),
  ]);
  return { learning, events, memory, profile, achievements };
}

function assertExperience(snapshot) {
  assert.equal(snapshot.learning.current_session.topic, TOPIC);
  assert.equal(snapshot.learning.current_session.steps[0].status, 'done');
  assert.equal(
    snapshot.events.events.filter((event) => event.event_type === 'manual_step_done').length,
    1
  );
  assert.ok(snapshot.events.events.some((event) => event.user_input === RESULT));
  assert.ok(snapshot.memory.growth_records.some((record) => record.text === RESULT && record.source === '成长记录'));
  assert.ok(snapshot.profile.profile.some((signal) => signal.value === TOPIC));
  assert.ok(snapshot.achievements.achievements.some((item) => item.key === 'learning:new_path' && item.unlocked));
  assert.ok(snapshot.achievements.achievements.some((item) => item.key === 'learning:first_step' && item.unlocked));
}

async function startPersistentServer(dbPath) {
  process.env.ECHO_DB_PATH = dbPath;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ECHO_LLM_PROVIDER;
  delete process.env.SILICONFLOW_API_KEY;
  await closeMemoryStore();

  const app = await createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await closeMemoryStore();
    },
  };
}

async function postJson(baseUrl, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body.error || body));
  return body.data || body;
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body.error || body));
  return body.data || body;
}
