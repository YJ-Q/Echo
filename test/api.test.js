import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { closeMemoryStore, ensureMemoryStore } from '../src/storage/memoryStore.js';
import { exportEchoDataSnapshot, importEchoDataSnapshot } from '../src/services/backupService.js';

test('GET /state returns a stable empty-state shape', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/state?query=Node.js`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.data.current_state.emotion, 'neutral');
    assert.equal(data.data.next_action.type, 'open_conversation');
    assert.equal(data.data.current_action.status, 'suggested');
    assert.equal(data.data.current_learning.status, 'idle');
    assert.equal(data.data.current_memory.overview.total_memories, 0);
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
    assert.equal(state.data.current_action.type, 'continue_learning');
    assert.equal(state.data.current_action.progress.topic, 'Node.js');
    assert.equal(state.data.current_learning.topic, 'Node.js');
    assert.equal(state.data.current_learning.current_step.title, '说清 Node.js 是什么');
    assert.equal(state.data.current_learning.current_step_index, 0);
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

test('GET /summary/recent returns a page-ready reflection view model and state exposes current reflection', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我今天有点焦虑，还没开始做任务。'
      })
    });
    await fetch(`${ctx.baseUrl}/summary`, { method: 'POST' });

    const recentResponse = await fetch(`${ctx.baseUrl}/summary/recent?limit=7`);
    const recentBody = await recentResponse.json();
    const stateResponse = await fetch(`${ctx.baseUrl}/state`);
    const stateBody = await stateResponse.json();

    assert.equal(recentResponse.status, 200);
    assert.equal(stateResponse.status, 200);
    assert.equal(recentBody.ok, true);
    assert.ok(recentBody.data.current_reflection.latest_summary);
    assert.ok(recentBody.data.current_reflection.emotional_trend.length >= 1);
    assert.ok(recentBody.data.current_reflection.history.length >= 1);
    assert.ok(typeof recentBody.data.current_reflection.summary === 'string');
    assert.ok(stateBody.data.current_reflection.latest_summary);
    assert.equal(
      stateBody.data.current_reflection.latest_summary.date,
      recentBody.data.current_reflection.latest_summary.date
    );
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

test('GET /learning/active returns a page-ready current learning view model', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，但是总在开始前拖延。'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/learning/active`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.sessions.length, 1);
    assert.equal(body.data.current_session.topic, 'Node.js');
    assert.equal(body.data.current_learning.topic, 'Node.js');
    assert.equal(body.data.current_learning.current_step.title, '说清 Node.js 是什么');
    assert.equal(body.data.current_learning.total_steps, 4);
    assert.equal(body.data.current_learning.completed_steps, 0);
    assert.equal(body.data.current_learning.step_labels.length, 4);
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
    assert.ok(body.data.current_memory.overview.total_memories >= 1);
    assert.ok(Array.isArray(body.data.current_memory.tag_heatmap));
    assert.ok(typeof body.data.current_memory.summary === 'string');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /memory returns a page-ready memory view model and state exposes current memory', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，而且最近一直有点拖延。'
      })
    });
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '今天想到任务时会焦虑，但还是想继续推进。'
      })
    });

    const memoryResponse = await fetch(`${ctx.baseUrl}/memory?limit=20`);
    const memoryBody = await memoryResponse.json();
    const stateResponse = await fetch(`${ctx.baseUrl}/state`);
    const stateBody = await stateResponse.json();

    assert.equal(memoryResponse.status, 200);
    assert.equal(stateResponse.status, 200);
    assert.equal(memoryBody.ok, true);
    assert.ok(memoryBody.data.current_memory.overview.total_memories >= 2);
    assert.ok(Array.isArray(memoryBody.data.current_memory.recent_memory_notes));
    assert.ok(Array.isArray(memoryBody.data.current_memory.priority_groups.core));
    assert.ok(Array.isArray(memoryBody.data.current_memory.tag_heatmap));
    assert.ok(typeof memoryBody.data.current_memory.summary === 'string');
    assert.ok(stateBody.data.current_memory);
    assert.ok(typeof stateBody.data.current_memory.summary === 'string');
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
    assert.equal(body.data.current_action.title, '先做 5 分钟');
    assert.equal(body.data.decision.source, 'pending_action_queue');
  } finally {
    await ctx.cleanup();
  }
});

test('activating one action demotes other active actions and state exposes the current action card', async () => {
  const ctx = await startTestServer();

  try {
    const first = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '主任务 A',
        detail: '先做 A',
        status: 'active'
      })
    });
    const firstBody = await first.json();
    const second = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '主任务 B',
        detail: '再做 B'
      })
    });
    const secondBody = await second.json();

    await fetch(`${ctx.baseUrl}/actions/${secondBody.data.action.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' })
    });

    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();
    const stateResponse = await fetch(`${ctx.baseUrl}/state`);
    const stateBody = await stateResponse.json();
    const activeActions = actionsBody.data.actions.filter((action) => action.status === 'active');
    const firstAction = actionsBody.data.actions.find((action) => action.id === firstBody.data.action.id);

    assert.equal(actionsResponse.status, 200);
    assert.equal(stateResponse.status, 200);
    assert.equal(activeActions.length, 1);
    assert.equal(activeActions[0].title, '主任务 B');
    assert.equal(firstAction.status, 'pending');
    assert.equal(stateBody.data.current_action.title, '主任务 B');
    assert.equal(stateBody.data.current_action.status, 'active');
    assert.equal(stateBody.data.current_action.completion_hint, '完成当前动作后，再决定下一步。');
  } finally {
    await ctx.cleanup();
  }
});

test('memory retrieval keeps both topic continuity and core anchor memories in context', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Rust，但是最近总在开始前拖延。'
      })
    });
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我们一直反复卡在开始动作上，这件事想先记住。'
      })
    });

    const memoriesResponse = await fetch(`${ctx.baseUrl}/memory?limit=10`);
    const memoriesBody = await memoriesResponse.json();
    const coreCandidate = memoriesBody.data.memories.find((memory) => {
      return /开始动作|拖延|卡在/.test(memory.memory_note || memory.user_input);
    });

    assert.ok(coreCandidate);

    await fetch(`${ctx.baseUrl}/memory/${coreCandidate.id}/pin`, {
      method: 'POST'
    });

    const contextResponse = await fetch(`${ctx.baseUrl}/memory/context?query=Rust`);
    const contextBody = await contextResponse.json();
    const relevant = contextBody.data.context.relevantMemories;
    const channels = new Set(relevant.flatMap((memory) => memory.retrieval?.channels || []));

    assert.equal(contextResponse.status, 200);
    assert.equal(contextBody.ok, true);
    assert.ok(Array.isArray(contextBody.data.context.summary.recall_channels));
    assert.ok(relevant.some((memory) => /rust/i.test(memory.user_input) || /rust/i.test(memory.memory_note)));
    assert.ok(relevant.some((memory) => memory.pinned));
    assert.ok(channels.has('learning_continuity') || channels.has('direct_match'));
    assert.ok(channels.has('core_anchor'));
  } finally {
    await ctx.cleanup();
  }
});

test('backup export writes a JSON snapshot with core Echo tables', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 Node.js，并且今天一直有点拖延。'
      })
    });

    const exportDir = path.join(ctx.tempDir, 'exports');
    const result = await exportEchoDataSnapshot({ outDir: exportDir });
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(result.file_path, 'utf8'));
    const parsed = JSON.parse(raw);

    assert.equal(result.format, 'json');
    assert.ok(result.counts.conversations >= 1);
    assert.ok(Array.isArray(parsed.data.conversations));
    assert.ok(Array.isArray(parsed.data.user_profile));
    assert.ok(Array.isArray(parsed.data.user_states));
  } finally {
    await ctx.cleanup();
  }
});

test('backup import restores a JSON snapshot into a fresh Echo database', async () => {
  const source = await startTestServer();
  let sourceCleaned = false;
  let importDir = '';
  let snapshotDir = '';
  let importedServer = null;

  try {
    await fetch(`${source.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想学 TypeScript，而且最近总在开始前犹豫。'
      })
    });

    snapshotDir = await mkdtemp(path.join(os.tmpdir(), 'echo-snapshot-'));
    const exportDir = snapshotDir;
    const snapshot = await exportEchoDataSnapshot({ outDir: exportDir });

    await source.cleanup();
    sourceCleaned = true;

    importDir = await mkdtemp(path.join(os.tmpdir(), 'echo-import-'));
    const targetDbPath = path.join(importDir, 'echo.sqlite');
    process.env.ECHO_DB_PATH = targetDbPath;

    await ensureMemoryStore();
    await closeMemoryStore();

    const dryRun = await importEchoDataSnapshot({
      filePath: snapshot.file_path,
      dryRun: true
    });
    const applied = await importEchoDataSnapshot({
      filePath: snapshot.file_path,
      mode: 'merge'
    });

    const importedApp = await createApp();
    importedServer = await new Promise((resolve) => {
      const instance = importedApp.listen(0, () => resolve(instance));
    });
    const address = importedServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const memoryResponse = await fetch(`http://127.0.0.1:${port}/memory?limit=10`);
    const memoryBody = await memoryResponse.json();

    assert.equal(dryRun.dry_run, true);
    assert.equal(applied.dry_run, false);
    assert.ok(applied.counts.conversations >= 1);
    assert.equal(memoryResponse.status, 200);
    assert.ok(memoryBody.data.memories.some((memory) => /TypeScript/i.test(memory.user_input) || /TypeScript/i.test(memory.memory_note)));

  } finally {
    if (importedServer) {
      await new Promise((resolve, reject) => {
        importedServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    await closeMemoryStore();
    delete process.env.ECHO_DB_PATH;
    if (importDir) {
      await rm(importDir, { recursive: true, force: true });
    }
    if (snapshotDir) {
      await rm(snapshotDir, { recursive: true, force: true });
    }
    if (!sourceCleaned) {
      await source.cleanup();
    }
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
    tempDir,
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
