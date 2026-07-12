import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { resetTtsProvider } from '../src/services/ttsProvider.js';
import { resetSttProvider } from '../src/services/sttProvider.js';
import { closeMemoryStore, ensureMemoryStore, saveSummary } from '../src/storage/memoryStore.js';
import { exportEchoDataSnapshot, importEchoDataSnapshot } from '../src/services/backupService.js';

test('POST /tts returns a stable code for upstream HTTP failures', async () => {
  const ctx = await startTestServer();
  const originalFetch = global.fetch;

  try {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    global.fetch = async () => new Response('rate limited', {
      status: 429,
      headers: { 'content-type': 'text/plain' }
    });
    resetTtsProvider();

    const response = await originalFetch(`${ctx.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'tts_provider_http_error');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    resetTtsProvider();
    await ctx.cleanup();
  }
});

test('POST /tts returns a stable code for JSON success payloads', async () => {
  const ctx = await startTestServer();
  const originalFetch = global.fetch;

  try {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    global.fetch = async () => new Response(JSON.stringify({ error: 'quota exceeded' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    resetTtsProvider();

    const response = await originalFetch(`${ctx.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'tts_provider_json_response');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    resetTtsProvider();
    await ctx.cleanup();
  }
});

test('POST /tts returns a stable code for empty audio payloads', async () => {
  const ctx = await startTestServer();
  const originalFetch = global.fetch;

  try {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    global.fetch = async () => new Response(new Uint8Array(0), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' }
    });
    resetTtsProvider();

    const response = await originalFetch(`${ctx.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'tts_empty_audio');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    resetTtsProvider();
    await ctx.cleanup();
  }
});

test('POST /tts returns a stable code for request failures before any response', async () => {
  const ctx = await startTestServer();
  const originalFetch = global.fetch;

  try {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    global.fetch = async () => {
      throw new Error('network down');
    };
    resetTtsProvider();

    const response = await originalFetch(`${ctx.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'tts_provider_request_failed');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    resetTtsProvider();
    await ctx.cleanup();
  }
});

test('POST /stt transcribes an in-memory browser recording without writing a file', async () => {
  const ctx = await startTestServer();
  const originalFetch = global.fetch;

  try {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    global.fetch = async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.equal(options.body instanceof FormData, true);
      assert.equal(options.body.get('file').type, 'audio/webm');
      return new Response(JSON.stringify({ text: '写入输入框，不自动发送。' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    resetSttProvider();

    const response = await originalFetch(`${ctx.baseUrl}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: Buffer.from('webm-audio').toString('base64'),
        mime_type: 'audio/webm',
        filename: 'margin-recording.webm'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.transcript, '写入输入框，不自动发送。');
    assert.equal(body.data.provider, 'siliconflow');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    resetSttProvider();
    await ctx.cleanup();
  }
});

test('POST /stt rejects invalid base64 before contacting the provider', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: 'not base64!' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid_audio_encoding');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /management/overview returns a read-only learning overview', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但总是在开始前拖延。');

    const response = await fetch(`${ctx.baseUrl}/management/overview?scope=learning`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.scope, 'learning');
    assert.equal(body.data.headline, '学习线整理');
    assert.equal(body.data.risk_level, 'read_only');
    assert.equal(body.data.stats.total, 1);
    assert.equal(body.data.stats.active, 1);
    assert.ok(body.data.stats_items.some((stat) => stat.key === 'active' && stat.value === 1));
    assert.ok(body.data.candidates.some((candidate) => candidate.target_type === 'learning_session'));
    assert.ok(Array.isArray(body.data.suggested_operations));
    assert.ok(body.data.available_operations.includes('archive'));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /management/overview returns action duplicate candidates without executing changes', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '整理 Node.js 学习线'
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '整理 Node.js 学习线',
        source: 'imported'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/management/overview?scope=actions`);
    const body = await response.json();
    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.scope, 'actions');
    assert.equal(body.data.headline, '行动整理');
    assert.equal(body.data.risk_level, 'read_only');
    assert.equal(body.data.stats.duplicate_candidates, 1);
    assert.ok(body.data.stats_items.some((stat) => stat.key === 'duplicate_candidates' && stat.value === 1));
    assert.ok(body.data.candidates.some((candidate) => candidate.suggested_operation === 'dismiss'));
    assert.ok(body.data.suggested_operations.some((operation) => operation.operation_type === 'dismiss'));
    assert.equal(body.data.available_operations.includes('merge'), false);
    assert.equal(actionsBody.data.actions.length, 2);
    assert.ok(actionsBody.data.actions.every((action) => action.status === 'pending'));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /management/overview returns a memory overview with frontend-friendly fields', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '我想把 Node.js 学习入口缩小到第一步。'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/management/overview?scope=memory`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.scope, 'memory');
    assert.equal(body.data.headline, '记忆整理');
    assert.ok(typeof body.data.summary === 'string');
    assert.ok(Number.isInteger(body.data.stats.total));
    assert.ok(body.data.stats_items.some((stat) => stat.key === 'total'));
    assert.ok(Array.isArray(body.data.candidates));
    assert.ok(Array.isArray(body.data.suggested_operations));
    assert.equal(body.data.risk_level, 'read_only');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /chat returns a management overview for governance requests', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但总是在开始前拖延。');

    const response = await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '你帮我梳理一下当前的学习线路，我们一起讨论修改或者删除'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.intent, 'management');
    assert.equal(body.data.management_intent.primary_scope, 'learning');
    assert.equal(body.data.management_overview.scope, 'learning');
    assert.equal(body.data.management_overview.risk_level, 'read_only');
    assert.match(body.data.reply, /只读梳理/);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /achievements returns a stable achievement wall view model', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但总是在开始前拖延。');

    const response = await fetch(`${ctx.baseUrl}/achievements`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.summary.total >= 1);
    assert.ok(body.data.summary.unlocked >= 1);
    assert.ok(body.data.groups.some((group) => group.key === 'learning'));
    assert.ok(body.data.achievements.some((achievement) => achievement.key === 'learning:new_path' && achievement.unlocked));
    assert.ok(Array.isArray(body.data.recent_unlocks));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /achievements/recent returns recent backend-derived unlocks', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 TypeScript，先建立一条学习线。');

    const response = await fetch(`${ctx.baseUrl}/achievements/recent?limit=2`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.recent_unlocks.length >= 1);
    assert.ok(body.data.recent_unlocks.length <= 2);
    assert.ok(body.data.recent_unlocks.every((unlock) => unlock.unlocked_at));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /achievements/icons returns the fixed achievement icon catalog', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/achievements/icons`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.icons.some((icon) => icon.icon_type === 'first_step'));
    assert.ok(body.data.icons.every((icon) => typeof icon.asset_path === 'string'));
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals creates an operation proposal without executing it', async () => {
  const ctx = await startTestServer();

  try {
    const actionResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '旧任务可以稍后整理',
        source: 'manual'
      })
    });
    const actionBody = await actionResponse.json();
    const actionId = actionBody.data.action.id;

    const createResponse = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'actions',
        operation_intent: 'dismiss',
        target_ids: [actionId],
        summary: '建议 dismiss 1 个已经过期的任务。',
        preview: {
          before: ['旧任务仍在 pending 队列中'],
          after: ['旧任务从主队列移除，但仍保留历史记录']
        }
      })
    });
    const createBody = await createResponse.json();
    const listResponse = await fetch(`${ctx.baseUrl}/management/proposals?scope=actions&status=awaiting_confirmation`);
    const listBody = await listResponse.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/management/operation-events?proposalId=${createBody.data.proposal.id}`);
    const eventsBody = await eventsResponse.json();
    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();
    const unchangedAction = actionsBody.data.actions.find((action) => action.id === actionId);

    assert.equal(createResponse.status, 201);
    assert.equal(createBody.ok, true);
    assert.equal(createBody.data.proposal.status, 'awaiting_confirmation');
    assert.equal(createBody.data.proposal.scope, 'actions');
    assert.equal(createBody.data.proposal.risk_level, 'reversible');
    assert.equal(createBody.data.proposal.operations[0].operation_type, 'dismiss');
    assert.equal(createBody.data.proposal.operations[0].target_type, 'action');
    assert.equal(createBody.data.proposal.operations[0].target_id, actionId);
    assert.equal(createBody.data.proposal.metadata.execution_state, 'not_executed');

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.data.proposals.length, 1);
    assert.equal(listBody.data.proposals[0].id, createBody.data.proposal.id);

    assert.equal(eventsResponse.status, 200);
    assert.equal(eventsBody.data.events.length, 1);
    assert.equal(eventsBody.data.events[0].event_type, 'proposal_created');
    assert.equal(eventsBody.data.events[0].proposal_id, createBody.data.proposal.id);

    assert.equal(unchangedAction.status, 'pending');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals rejects invalid target ids', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'memory',
        operation_intent: 'archive',
        target_ids: ['not-a-number']
      })
    });
    const body = await response.json();
    const listResponse = await fetch(`${ctx.baseUrl}/management/proposals`);
    const listBody = await listResponse.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid_target_id');
    assert.equal(listBody.data.proposals.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals rejects operations that the executor cannot perform', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'memory',
        operation_intent: 'merge',
        target_type: 'memory',
        target_id: 1
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'unsupported_operation');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals/:id/confirm executes a reversible action dismiss once', async () => {
  const ctx = await startTestServer();

  try {
    const actionResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '可以被整理掉的旧任务'
      })
    });
    const actionBody = await actionResponse.json();
    const actionId = actionBody.data.action.id;

    const proposalResponse = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'actions',
        operation_intent: 'dismiss',
        target_ids: [actionId]
      })
    });
    const proposalBody = await proposalResponse.json();
    const proposalId = proposalBody.data.proposal.id;

    const firstConfirm = await fetch(`${ctx.baseUrl}/management/proposals/${proposalId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation_text: '确认执行' })
    });
    const firstBody = await firstConfirm.json();
    const secondConfirm = await fetch(`${ctx.baseUrl}/management/proposals/${proposalId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation_text: '确认执行' })
    });
    const secondBody = await secondConfirm.json();
    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/management/operation-events?proposalId=${proposalId}`);
    const eventsBody = await eventsResponse.json();
    const dismissedAction = actionsBody.data.actions.find((action) => action.id === actionId);
    const executedEvents = eventsBody.data.events.filter((event) => event.event_type === 'proposal_executed');

    assert.equal(firstConfirm.status, 200);
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.data.proposal.status, 'executed');
    assert.equal(firstBody.data.results[0].status, 'executed');
    assert.equal(firstBody.data.results[0].target_id, actionId);
    assert.equal(dismissedAction.status, 'dismissed');

    assert.equal(secondConfirm.status, 200);
    assert.equal(secondBody.data.already_executed, true);
    assert.equal(executedEvents.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals/:id/confirm rejects destructive proposals without executing them', async () => {
  const ctx = await startTestServer();

  try {
    const actionResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '不能被直接删除的任务'
      })
    });
    const actionBody = await actionResponse.json();
    const actionId = actionBody.data.action.id;
    const proposalResponse = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'actions',
        operation_intent: 'delete',
        target_ids: [actionId]
      })
    });
    const proposalBody = await proposalResponse.json();
    const proposalId = proposalBody.data.proposal.id;

    const confirmResponse = await fetch(`${ctx.baseUrl}/management/proposals/${proposalId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation_text: '确认执行' })
    });
    const confirmBody = await confirmResponse.json();
    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/management/operation-events?proposalId=${proposalId}`);
    const eventsBody = await eventsResponse.json();
    const unchangedAction = actionsBody.data.actions.find((action) => action.id === actionId);

    assert.equal(confirmResponse.status, 400);
    assert.equal(confirmBody.ok, false);
    assert.equal(confirmBody.error.code, 'destructive_proposal_not_supported');
    assert.equal(unchangedAction.status, 'pending');
    assert.ok(eventsBody.data.events.some((event) => event.event_type === 'proposal_execution_rejected'));
  } finally {
    await ctx.cleanup();
  }
});

test('POST /management/proposals/:id/cancel dismisses a proposal without executing it', async () => {
  const ctx = await startTestServer();

  try {
    const actionResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '暂时不用执行的整理候选'
      })
    });
    const actionBody = await actionResponse.json();
    const actionId = actionBody.data.action.id;

    const proposalResponse = await fetch(`${ctx.baseUrl}/management/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'actions',
        operation_intent: 'dismiss',
        target_ids: [actionId]
      })
    });
    const proposalBody = await proposalResponse.json();
    const proposalId = proposalBody.data.proposal.id;

    const cancelResponse = await fetch(`${ctx.baseUrl}/management/proposals/${proposalId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellation_reason: '先不处理这条草案' })
    });
    const cancelBody = await cancelResponse.json();
    const secondCancelResponse = await fetch(`${ctx.baseUrl}/management/proposals/${proposalId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancellation_reason: '重复取消' })
    });
    const secondCancelBody = await secondCancelResponse.json();
    const actionsResponse = await fetch(`${ctx.baseUrl}/actions`);
    const actionsBody = await actionsResponse.json();
    const unchangedAction = actionsBody.data.actions.find((action) => action.id === actionId);
    const eventsResponse = await fetch(`${ctx.baseUrl}/management/operation-events?proposalId=${proposalId}`);
    const eventsBody = await eventsResponse.json();
    const cancelledEvents = eventsBody.data.events.filter((event) => event.event_type === 'proposal_cancelled');

    assert.equal(cancelResponse.status, 200);
    assert.equal(cancelBody.ok, true);
    assert.equal(cancelBody.data.proposal.status, 'dismissed');
    assert.equal(cancelBody.data.proposal.metadata.execution_state, 'cancelled');
    assert.equal(cancelBody.data.proposal.metadata.cancellation_reason, '先不处理这条草案');
    assert.equal(unchangedAction.status, 'pending');

    assert.equal(secondCancelResponse.status, 200);
    assert.equal(secondCancelBody.data.already_cancelled, true);
    assert.equal(cancelledEvents.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

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

test('growth suggestion requires confirmation and confirmation is idempotent', async () => {
  const ctx = await startTestServer();

  try {
    const reflect = await postJson(ctx.baseUrl, '/api/reflect', {
      message: '我在会议里总是不敢完整表达，担心自己说得不够好。'
    });
    const before = await getJson(ctx.baseUrl, '/learning/active');

    assert.equal(reflect.result.learning_session, null);
    assert.equal(reflect.result.growth_suggestion.status, 'pending');
    assert.equal(before.current_session, null);

    const profileBefore = await getJson(ctx.baseUrl, '/memory/profile');
    assert.equal(profileBefore.profile.some((entry) => entry.key === 'current_learning_focus'), false);

    const key = reflect.result.growth_suggestion.key;
    const first = await postJson(
      ctx.baseUrl,
      `/learning/suggestions/${encodeURIComponent(key)}/confirm`,
      {}
    );
    const second = await postJson(
      ctx.baseUrl,
      `/learning/suggestions/${encodeURIComponent(key)}/confirm`,
      {}
    );
    const after = await getJson(ctx.baseUrl, '/learning/active');

    assert.equal(first.session.id, second.session.id);
    assert.equal(second.already_confirmed, true);
    assert.equal(after.sessions.length, 1);
    assert.equal(after.current_learning.topic, '在会议中更完整地表达');

    const profileAfter = await getJson(ctx.baseUrl, '/memory/profile');
    assert.equal(
      profileAfter.profile.find((entry) => entry.key === 'current_learning_focus').value,
      '在会议中更完整地表达'
    );
  } finally {
    await ctx.cleanup();
  }
});

test('POST /chat learning request waits for confirmation before updating /state', async () => {
  const ctx = await startTestServer();

  try {
    const chat = await postJson(ctx.baseUrl, '/chat', {
      message: '我想学 Node.js，但是总在开始前拖延。'
    });
    assert.equal(chat.intent, 'learning');
    assert.equal(chat.learning_session, null);
    assert.equal(chat.growth_suggestion.topic, 'Node.js');

    await postJson(
      ctx.baseUrl,
      `/learning/suggestions/${encodeURIComponent(chat.growth_suggestion.key)}/confirm`,
      {}
    );
    const stateResponse = await fetch(`${ctx.baseUrl}/state?query=Node.js`);
    const state = await stateResponse.json();

    assert.equal(chat.agent.provider, 'local');
    assert.match(chat.memory_note, /Node\.js/);
    assert.ok(chat.insight_note.length > 0);
    assert.equal(chat.explanation.input_analysis.intent, 'learning');
    assert.equal(stateResponse.status, 200);
    assert.equal(state.ok, true);
    assert.equal(state.data.next_action.type, 'continue_learning');
    assert.equal(state.data.current_action.type, 'continue_learning');
    assert.equal(state.data.current_action.progress.topic, 'Node.js');
    assert.equal(state.data.current_learning.topic, 'Node.js');
    assert.equal(state.data.current_learning.current_step.title, '完成本周小实验');
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
    assert.equal(
      firstBody.data.action.metadata.suggested_identity,
      'echo_state:open_conversation:conversation_opening'
    );
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state reflects the latest summary when no stronger learning or pending action signal exists', async () => {
  const ctx = await startTestServer();
  const summary = {
    date: '2026-07-08',
    summary: '今天的总结停在先把入口缩小，再决定要不要展开。',
    emotional_trend: 'neutral',
    behavioral_pattern: '入口已经缩小到可以回看最近反思。',
    echo_reflection: '先读一遍今天留下的回声，再决定下一步。'
  };

  try {
    await saveSummary(summary);

    const response = await fetch(`${ctx.baseUrl}/state`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.next_action.type, 'reflect_recent');
    assert.equal(body.data.next_action.detail, summary.echo_reflection);
    assert.equal(body.data.next_action.reason, summary.summary);
    assert.equal(body.data.decision.rule, 'reflect_recent');
    assert.equal(body.data.decision.reflection.used_in_decision, true);
    assert.equal(body.data.decision.reflection.behavioral_pattern, summary.behavioral_pattern);
    assert.equal(body.data.explain.decision_trace.detail, summary.echo_reflection);
    assert.equal(body.data.explain.decision_trace.reason, summary.summary);
    assert.equal(body.data.explain.reflection_signal.used_in_decision, true);
    assert.equal(body.data.explain.reflection_signal.behavioral_pattern, summary.behavioral_pattern);
    assert.equal(body.data.explain.reflection_signal.echo_reflection, summary.echo_reflection);
    assert.match(body.data.explain.summary, /2026-07-08/);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/suggested reuses an existing suggested identity even if the title changed', async () => {
  const ctx = await startTestServer();

  try {
    const seeded = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'open_conversation',
        title: '旧文案：先写一句',
        detail: '旧版本生成的建议。',
        source: 'echo_state',
        status: 'active',
        metadata: {
          suggested_identity: 'echo_state:open_conversation:conversation_opening'
        }
      })
    });
    const suggested = await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' })
    });
    const actions = await fetch(`${ctx.baseUrl}/actions`);
    const seededBody = await seeded.json();
    const suggestedBody = await suggested.json();
    const actionsBody = await actions.json();

    assert.equal(seeded.status, 201);
    assert.equal(suggested.status, 201);
    assert.equal(suggestedBody.data.action.id, seededBody.data.action.id);
    assert.equal(suggestedBody.data.action.title, '旧文案：先写一句');
    assert.equal(actionsBody.data.actions.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status returns 400 for an invalid action id', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/actions/not-a-number/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid_action_id');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status returns 400 for an invalid action status', async () => {
  const ctx = await startTestServer();

  try {
    const createResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Valid action'
      })
    });
    const createBody = await createResponse.json();
    const response = await fetch(`${ctx.baseUrl}/actions/${createBody.data.action.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid_action_status');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status returns 404 when the action does not exist', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/actions/999/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'action_not_found');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions normalizes empty titles, clamps priority, and falls back invalid status to pending', async () => {
  const ctx = await startTestServer();

  try {
    const highPriorityResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '',
        priority: 99,
        status: 'paused'
      })
    });
    const lowPriorityResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Lower bound',
        priority: -3
      })
    });
    const highPriorityBody = await highPriorityResponse.json();
    const lowPriorityBody = await lowPriorityResponse.json();

    assert.equal(highPriorityResponse.status, 201);
    assert.ok(highPriorityBody.data.action.title.trim().length > 0);
    assert.equal(highPriorityBody.data.action.priority, 5);
    assert.equal(highPriorityBody.data.action.status, 'pending');
    assert.equal(lowPriorityBody.data.action.priority, 1);
    assert.equal(lowPriorityBody.data.action.status, 'pending');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /actions?status=pending returns only pending actions in deterministic order', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Older pending',
        priority: 2
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Newer pending',
        priority: 2
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'First priority pending',
        priority: 1
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Done action',
        priority: 1,
        status: 'done'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/actions?status=pending`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(
      body.data.actions.map((action) => action.title),
      ['First priority pending', 'Newer pending', 'Older pending']
    );
    assert.ok(body.data.actions.every((action) => action.status === 'pending'));
  } finally {
    await ctx.cleanup();
  }
});

test('GET /learning/active returns a page-ready current learning view model', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但是总在开始前拖延。');

    const response = await fetch(`${ctx.baseUrl}/learning/active`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.sessions.length, 1);
    assert.equal(body.data.current_session.topic, 'Node.js');
    assert.equal(body.data.current_learning.topic, 'Node.js');
    assert.equal(body.data.current_learning.current_step.title, '完成本周小实验');
    assert.equal(body.data.current_learning.total_steps, 3);
    assert.equal(body.data.current_learning.completed_steps, 0);
    assert.equal(body.data.current_learning.step_labels.length, 3);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /learning/:id/steps/:stepIndex records standardized manual learning events', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但是总在开始前拖延。');

    const activeResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const activeBody = await activeResponse.json();
    const sessionId = activeBody.data.current_session.id;
    const updateResponse = await fetch(`${ctx.baseUrl}/learning/${sessionId}/steps/0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const eventsResponse = await fetch(`${ctx.baseUrl}/learning/events?sessionId=${sessionId}`);
    const eventsBody = await eventsResponse.json();
    const event = eventsBody.data.events[0];

    assert.equal(updateResponse.status, 200);
    assert.equal(event.event_type, 'manual_step_done');
    assert.equal(event.step_index, 0);
    assert.equal(event.step_title, '完成本周小实验');
    assert.match(event.note, /manually changed to done/);
    assert.match(event.note, /manual_status_done/);
    assert.equal(event.user_input, null);
  } finally {
    await ctx.cleanup();
  }
});

test('learning step result persistence and duplicate completion stay idempotent', async () => {
  const ctx = await startTestServer();

  try {
    const confirmation = await confirmGrowthFromMessage(
      ctx.baseUrl,
      'I want to learn how to express my full point in meetings without stopping halfway.'
    );
    const sessionId = confirmation.session.id;
    const payload = { status: 'done', result: '我先说完了一个观点，没有在中途自我否定。' };

    const first = await postJson(ctx.baseUrl, `/learning/${sessionId}/steps/0`, payload);
    const second = await postJson(ctx.baseUrl, `/learning/${sessionId}/steps/0`, payload);
    const events = await getJson(ctx.baseUrl, `/learning/events?sessionId=${sessionId}`);
    const completions = events.events.filter((event) => event.event_type === 'manual_step_done');
    const memory = await getJson(ctx.baseUrl, '/memory');

    assert.equal(first.already_applied, false);
    assert.equal(second.already_applied, true);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].user_input, payload.result);
    assert.ok(memory.growth_records.some((record) => record.text === payload.result));
  } finally {
    await ctx.cleanup();
  }
});

test('learning result longer than 4000 characters is rejected', async () => {
  const ctx = await startTestServer();

  try {
    const confirmation = await confirmGrowthFromMessage(
      ctx.baseUrl,
      'I want to learn how to express my full point in meetings without stopping halfway.'
    );
    const response = await fetch(`${ctx.baseUrl}/learning/${confirmation.session.id}/steps/0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', result: 'a'.repeat(4001) })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'learning_result_too_long');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status done syncs linked learning step completion and records a learning event', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(
      ctx.baseUrl,
      'I want to learn Node.js but I keep procrastinating before I start.'
    );

    const activeResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const activeBody = await activeResponse.json();
    const sessionId = activeBody.data.current_session.id;
    const stepTitle = activeBody.data.current_session.steps[0].title;
    const suggestedResponse = await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Node.js' })
    });
    const suggestedBody = await suggestedResponse.json();
    const actionId = suggestedBody.data.action.id;
    const updateResponse = await fetch(`${ctx.baseUrl}/actions/${actionId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const refreshedActiveResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const refreshedActiveBody = await refreshedActiveResponse.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/learning/events?sessionId=${sessionId}`);
    const eventsBody = await eventsResponse.json();
    const completionEvent = eventsBody.data.events.find((event) => event.event_type === 'manual_step_done');

    assert.equal(updateResponse.status, 200);
    assert.equal(refreshedActiveBody.data.current_session.steps[0].status, 'done');
    assert.ok(completionEvent);
    assert.equal(completionEvent.step_index, 0);
    assert.equal(completionEvent.step_title, stepTitle);
    assert.match(completionEvent.note, /action_status_done/);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status done is idempotent for linked learning actions', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(
      ctx.baseUrl,
      'I want to learn Node.js but I keep procrastinating before I start.'
    );

    const activeResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const activeBody = await activeResponse.json();
    const sessionId = activeBody.data.current_session.id;
    const suggestedResponse = await fetch(`${ctx.baseUrl}/actions/suggested`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Node.js' })
    });
    const suggestedBody = await suggestedResponse.json();
    const actionId = suggestedBody.data.action.id;

    await fetch(`${ctx.baseUrl}/actions/${actionId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    await fetch(`${ctx.baseUrl}/actions/${actionId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });

    const eventsResponse = await fetch(`${ctx.baseUrl}/learning/events?sessionId=${sessionId}`);
    const eventsBody = await eventsResponse.json();
    const completionEvents = eventsBody.data.events.filter((event) => event.event_type === 'manual_step_done');

    assert.equal(completionEvents.length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('POST /actions/:id/status done does not write learning events for manual actions without learning metadata', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(
      ctx.baseUrl,
      'I want to learn Node.js but I keep procrastinating before I start.'
    );

    const activeResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const activeBody = await activeResponse.json();
    const sessionId = activeBody.data.current_session.id;
    const createResponse = await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Plain manual task',
        detail: 'This should not move any learning step.'
      })
    });
    const createBody = await createResponse.json();
    const actionId = createBody.data.action.id;

    await fetch(`${ctx.baseUrl}/actions/${actionId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });

    const refreshedActiveResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const refreshedActiveBody = await refreshedActiveResponse.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/learning/events?sessionId=${sessionId}`);
    const eventsBody = await eventsResponse.json();

    assert.equal(refreshedActiveBody.data.current_session.steps[0].status, 'active');
    assert.equal(eventsBody.data.events.length, 1);
    assert.equal(eventsBody.data.events[0].event_type, 'session_created');
  } finally {
    await ctx.cleanup();
  }
});

test('POST /learning/:id/steps/:stepIndex rejects out-of-range step updates', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但是总在开始前拖延。');

    const activeResponse = await fetch(`${ctx.baseUrl}/learning/active`);
    const activeBody = await activeResponse.json();
    const sessionId = activeBody.data.current_session.id;
    const response = await fetch(`${ctx.baseUrl}/learning/${sessionId}/steps/99`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    const body = await response.json();
    const eventsResponse = await fetch(`${ctx.baseUrl}/learning/events?sessionId=${sessionId}`);
    const eventsBody = await eventsResponse.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'learning_step_out_of_range');
    assert.equal(eventsBody.data.events.length, 1);
    assert.equal(eventsBody.data.events[0].event_type, 'session_created');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /memory/context returns layered memory injection context', async () => {
  const ctx = await startTestServer();

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但我总在开始前拖延。');

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
    assert.equal(context.injection.layers.pattern.recurring_pattern, '');
    assert.equal(context.injection.layers.action.pending_action.title, '继续：完成本周小实验');
    assert.match(context.injection.prompt_context, /Node\.js/);
    assert.match(context.summary.latest_memory_note, /Node\.js/);
    assert.ok(context.summary.insight_trail.length > 0);
    assert.ok(context.summary.priority_overview.core.length > 0);
    assert.ok(context.summary.memory_layers);
    assert.ok(Array.isArray(context.summary.memory_layers.core));
    assert.ok(Array.isArray(context.summary.memory_layers.working));
    assert.ok(Array.isArray(context.summary.memory_layers.recent));
    assert.ok(Array.isArray(context.summary.memory_layers.ambient));
    assert.ok(context.summary.memory_layers.core.some((memory) => memory.priority_bucket === 'core' || memory.pinned));
    assert.ok(context.summary.memory_layers.working.some((memory) => /node\.js/i.test(memory.user_input) || /node\.js/i.test(memory.memory_note)));
    assert.ok(context.injection.layers.memory);
    assert.ok(Array.isArray(context.injection.layers.memory.core_memories));
    assert.ok(Array.isArray(context.injection.layers.memory.working_memories));
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

test('GET /memory/profile returns a structured user-readable summary contract', async () => {
  const ctx = await startTestServer();

  try {
    const response = await fetch(`${ctx.baseUrl}/memory/profile`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data.profile));
    assert.equal(typeof body.data.summary, 'object');
    assert.ok(Array.isArray(body.data.summary.stable_signals));
    assert.ok(Array.isArray(body.data.summary.developing_signals));
    assert.equal(typeof body.data.summary.profile_note, 'string');
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
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但是总在开始前拖延。');
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

test('manual profile override resists lower-confidence learning updates but yields to a later manual override', async () => {
  const ctx = await startTestServer();

  try {
    const initialOverrideResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'current_learning_focus',
        value: 'Deep Work',
        confidence: 0.95
      })
    });
    const initialOverrideBody = await initialOverrideResponse.json();

    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我想学 Node.js，但总是在开始之前拖延。' })
    });
    await fetch(`${ctx.baseUrl}/memory/profile/refresh`, { method: 'POST' });

    const profileAfterChatResponse = await fetch(`${ctx.baseUrl}/memory/profile`);
    const profileAfterChatBody = await profileAfterChatResponse.json();
    const focusAfterChat = profileAfterChatBody.data.profile.find((entry) => entry.key === 'current_learning_focus');

    const laterOverrideResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'current_learning_focus',
        value: 'Node.js'
      })
    });
    const laterOverrideBody = await laterOverrideResponse.json();
    const finalFocus = laterOverrideBody.data.profile.find((entry) => entry.key === 'current_learning_focus');

    assert.equal(initialOverrideResponse.status, 200);
    assert.equal(initialOverrideBody.data.summary.current_learning_focus, 'Deep Work');

    assert.equal(profileAfterChatResponse.status, 200);
    assert.equal(profileAfterChatBody.data.summary.current_learning_focus, 'Deep Work');
    assert.equal(focusAfterChat.value, 'Deep Work');
    assert.equal(focusAfterChat.confidence, 0.95);

    assert.equal(laterOverrideResponse.status, 200);
    assert.equal(laterOverrideBody.data.summary.current_learning_focus, 'Node.js');
    assert.equal(finalFocus.value, 'Node.js');
    assert.equal(finalFocus.confidence, 0.92);
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration returns 404 for nonexistent memory pin and remains stable', async () => {
  const ctx = await startTestServer();

  try {
    const pinResponse = await fetch(`${ctx.baseUrl}/memory/9999/pin`, {
      method: 'POST'
    });
    const pinBody = await pinResponse.json();
    const snapshotResponse = await fetch(`${ctx.baseUrl}/memory/calibration`);
    const snapshotBody = await snapshotResponse.json();

    assert.equal(pinResponse.status, 404);
    assert.equal(pinBody.ok, false);
    assert.equal(pinBody.error.code, 'memory_not_found');
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotBody.ok, true);
    assert.deepEqual(snapshotBody.data.pinned_memories, []);
    assert.deepEqual(snapshotBody.data.high_priority_memories, []);
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration clamps memory priority numeric bounds and rejects missing memories', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我今天有点拖延，但这段记忆不需要一直很高优先级。' })
    });

    const memoriesResponse = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const memoriesBody = await memoriesResponse.json();
    const memoryId = memoriesBody.data.memories[0].id;

    const clampResponse = await fetch(`${ctx.baseUrl}/memory/${memoryId}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salience: 42,
        priority_bucket: 'important',
        pinned: false,
        reinforcement_count: -3
      })
    });
    const clampBody = await clampResponse.json();

    const missingResponse = await fetch(`${ctx.baseUrl}/memory/9999/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salience: 0.5,
        reinforcement_count: 5
      })
    });
    const missingBody = await missingResponse.json();

    const invalidIdResponse = await fetch(`${ctx.baseUrl}/memory/not-a-number/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salience: 0.5
      })
    });
    const invalidIdBody = await invalidIdResponse.json();

    assert.equal(clampResponse.status, 200);
    assert.equal(clampBody.ok, true);
    assert.equal(clampBody.data.memory.salience, 1);
    assert.equal(clampBody.data.memory.reinforcement_count, 1);
    assert.equal(clampBody.data.memory.priority_bucket, 'important');
    assert.equal(clampBody.data.memory.pinned, false);

    assert.equal(missingResponse.status, 404);
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.error.code, 'memory_not_found');

    assert.equal(invalidIdResponse.status, 400);
    assert.equal(invalidIdBody.ok, false);
    assert.equal(invalidIdBody.error.code, 'invalid_memory_id');
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration profile override validates input and applies default and clamped confidence', async () => {
  const ctx = await startTestServer();

  try {
    const missingKeyResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: 'Deep Work'
      })
    });
    const missingKeyBody = await missingKeyResponse.json();
    const missingValueResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'current_learning_focus'
      })
    });
    const missingValueBody = await missingValueResponse.json();

    const defaultConfidenceResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'manual_focus_default',
        value: 'Deep Work'
      })
    });
    const defaultConfidenceBody = await defaultConfidenceResponse.json();
    const defaultEntry = defaultConfidenceBody.data.profile.find((entry) => entry.key === 'manual_focus_default');

    const clampedConfidenceResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'manual_focus_clamped',
        value: 'Calm Start',
        confidence: 5
      })
    });
    const clampedConfidenceBody = await clampedConfidenceResponse.json();
    const clampedEntry = clampedConfidenceBody.data.profile.find((entry) => entry.key === 'manual_focus_clamped');

    assert.equal(missingKeyResponse.status, 400);
    assert.equal(missingKeyBody.ok, false);
    assert.equal(missingKeyBody.error.code, 'profile_override_required');
    assert.equal(missingValueResponse.status, 400);
    assert.equal(missingValueBody.ok, false);
    assert.equal(missingValueBody.error.code, 'profile_override_required');

    assert.equal(defaultConfidenceResponse.status, 200);
    assert.equal(defaultConfidenceBody.ok, true);
    assert.equal(defaultEntry.value, 'Deep Work');
    assert.equal(defaultEntry.confidence, 0.92);

    assert.equal(clampedConfidenceResponse.status, 200);
    assert.equal(clampedConfidenceBody.ok, true);
    assert.equal(clampedEntry.value, 'Calm Start');
    assert.equal(clampedEntry.confidence, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('manual calibration snapshot stays stable when empty and after override, pin, and priority updates', async () => {
  const ctx = await startTestServer();

  try {
    const emptySnapshotResponse = await fetch(`${ctx.baseUrl}/memory/calibration`);
    const emptySnapshotBody = await emptySnapshotResponse.json();

    await fetch(`${ctx.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '我最近在学 TypeScript，不过启动之前总会有点卡住。' })
    });

    const memoriesResponse = await fetch(`${ctx.baseUrl}/memory?limit=1`);
    const memoriesBody = await memoriesResponse.json();
    const memoryId = memoriesBody.data.memories[0].id;

    const overrideResponse = await fetch(`${ctx.baseUrl}/memory/profile/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'current_learning_focus',
        value: 'TypeScript'
      })
    });
    const pinResponse = await fetch(`${ctx.baseUrl}/memory/${memoryId}/pin`, {
      method: 'POST'
    });
    const priorityResponse = await fetch(`${ctx.baseUrl}/memory/${memoryId}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salience: 0.4,
        priority_bucket: 'important',
        pinned: false,
        reinforcement_count: 12
      })
    });
    const snapshotResponse = await fetch(`${ctx.baseUrl}/memory/calibration`);
    const snapshotBody = await snapshotResponse.json();

    assert.equal(emptySnapshotResponse.status, 200);
    assert.equal(emptySnapshotBody.ok, true);
    assert.deepEqual(emptySnapshotBody.data.pinned_memories, []);
    assert.deepEqual(emptySnapshotBody.data.high_priority_memories, []);

    assert.equal(overrideResponse.status, 200);
    assert.equal(pinResponse.status, 200);
    assert.equal(priorityResponse.status, 200);

    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotBody.ok, true);
    assert.ok(Array.isArray(snapshotBody.data.pinned_memories));
    assert.ok(Array.isArray(snapshotBody.data.high_priority_memories));
    assert.equal(snapshotBody.data.pinned_memories.length, 0);
    assert.equal(snapshotBody.data.high_priority_memories.length, 1);
    assert.equal(snapshotBody.data.high_priority_memories[0].id, memoryId);
    assert.equal(snapshotBody.data.high_priority_memories[0].priority_bucket, 'important');
    assert.equal(snapshotBody.data.high_priority_memories[0].pinned, false);
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

test('GET /state current_action chooses the highest-priority pending action', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '普通待办',
        detail: '稍后再做',
        priority: 4,
        source: 'manual'
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'start_small',
        title: '先开个头',
        detail: '只做两分钟',
        priority: 1,
        source: 'echo_state'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/state?query=writing`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.current_action.title, '先开个头');
    assert.equal(body.data.current_action.priority, 1);
    assert.equal(body.data.action_queue[0].title, '先开个头');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state keeps active learning ahead of recent reflection', async () => {
  const ctx = await startTestServer();
  const summary = {
    date: '2026-07-08',
    summary: '今天已经有反思，但学习线仍在进行。',
    emotional_trend: 'motivated',
    behavioral_pattern: '最近反思可回看，但不该盖过当前学习。',
    echo_reflection: '先记住今天的回声，等学习步骤结束再回来。'
  };

  try {
    await confirmGrowthFromMessage(ctx.baseUrl, '我想学 Node.js，但总是在开始前拖延。');
    await saveSummary(summary);

    const response = await fetch(`${ctx.baseUrl}/state?query=Node.js`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.next_action.type, 'continue_learning');
    assert.equal(body.data.decision.rule, 'continue_learning');
    assert.equal(body.data.decision.source, 'active_learning_session');
    assert.equal(body.data.explain.reflection_signal.used_in_decision, false);
    assert.equal(body.data.explain.reflection_signal.linkage, 'available_but_overridden');
    assert.equal(body.data.explain.reflection_signal.behavioral_pattern, summary.behavioral_pattern);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state current_action keeps an active action ahead of higher-priority pending work', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '手动主任务',
        detail: '现在进行',
        priority: 5,
        status: 'active',
        source: 'manual'
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'start_small',
        title: '更高优先级待办',
        detail: '数字优先级更高',
        priority: 1,
        source: 'echo_state'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/state?query=writing`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.current_action.title, '手动主任务');
    assert.equal(body.data.current_action.status, 'active');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state keeps pending echo actions ahead of recent reflection when applicable', async () => {
  const ctx = await startTestServer();
  const summary = {
    date: '2026-07-08',
    summary: '今天已经留下反思，但还有一个待接上的 echo 动作。',
    emotional_trend: 'neutral',
    behavioral_pattern: '最近反思可回看，但待办动作更具体。',
    echo_reflection: '先确认上一次决定的动作，再回来看反思。'
  };

  try {
    await saveSummary(summary);
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
    assert.equal(body.data.decision.rule, 'resume_pending_action');
    assert.equal(body.data.decision.source, 'pending_action_queue');
    assert.equal(body.data.explain.reflection_signal.used_in_decision, false);
    assert.equal(body.data.explain.reflection_signal.linkage, 'available_but_overridden');
    assert.equal(body.data.explain.reflection_signal.echo_reflection, summary.echo_reflection);
  } finally {
    await ctx.cleanup();
  }
});

test('GET /state current_action remains stable when multiple active actions exist', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: '较旧 active',
        detail: '旧的 active',
        priority: 2,
        status: 'active',
        source: 'manual'
      })
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'start_small',
        title: '较新 active',
        detail: '新的 active',
        priority: 2,
        status: 'active',
        source: 'echo_state'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/state?query=writing`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.current_action.title, '较新 active');
    assert.equal(body.data.current_action.status, 'active');
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

test('GET /state current_action ignores done and dismissed actions at the API level', async () => {
  const ctx = await startTestServer();

  try {
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Already done',
        priority: 1,
        status: 'done'
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Dismissed task',
        priority: 1,
        status: 'dismissed'
      })
    });
    await fetch(`${ctx.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'manual',
        title: 'Still pending',
        priority: 3,
        status: 'pending'
      })
    });

    const response = await fetch(`${ctx.baseUrl}/state?query=writing`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.current_action.title, 'Still pending');
    assert.equal(body.data.current_action.status, 'pending');
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
    const retrievalOverview = contextBody.data.context.summary.retrieval_overview;
    const channels = new Set(relevant.flatMap((memory) => memory.retrieval?.channels || []));
    const explained = relevant.find((memory) => memory.retrieval?.explanation?.channels?.length > 0);

    assert.equal(contextResponse.status, 200);
    assert.equal(contextBody.ok, true);
    assert.ok(Array.isArray(contextBody.data.context.summary.recall_channels));
    assert.equal(retrievalOverview.total_memories, relevant.length);
    assert.ok(retrievalOverview.strongest_channel);
    assert.ok(typeof retrievalOverview.strongest_channel.label === 'string');
    assert.ok(typeof retrievalOverview.strongest_channel.reason === 'string');
    assert.ok(typeof retrievalOverview.summary === 'string');
    assert.ok(typeof retrievalOverview.score_range.max === 'number');
    assert.ok(/rust/i.test(relevant[0].user_input) || /rust/i.test(relevant[0].memory_note));
    assert.ok(typeof relevant[0].retrieval.ranking_score === 'number');
    assert.ok(typeof relevant[0].retrieval.channel_score === 'number');
    assert.ok(explained);
    assert.equal(explained.retrieval.explanation.primary_channel, explained.retrieval.channels[0]);
    assert.ok(typeof explained.retrieval.explanation.summary === 'string');
    assert.ok(typeof explained.retrieval.explanation.channels[0].label === 'string');
    assert.ok(typeof explained.retrieval.explanation.channels[0].reason === 'string');
    assert.equal(
      explained.retrieval.explanation.scores.ranking_score,
      explained.retrieval.ranking_score
    );
    assert.ok(contextBody.data.context.summary.memory_layers.core.some((memory) => memory.pinned));
    assert.ok(contextBody.data.context.summary.memory_layers.working.some((memory) => /rust/i.test(memory.user_input) || /rust/i.test(memory.memory_note)));
    assert.ok(contextBody.data.context.injection.layers.memory.core_memories.some((memory) => memory.pinned));
    assert.ok(contextBody.data.context.injection.layers.memory.working_memories.length > 0);
    assert.ok(relevant.some((memory) => /rust/i.test(memory.user_input) || /rust/i.test(memory.memory_note)));
    assert.ok(relevant.some((memory) => memory.pinned));
    assert.ok(channels.has('learning_continuity') || channels.has('direct_match'));
    assert.ok(channels.has('core_anchor'));
  } finally {
    await ctx.cleanup();
  }
});

test('backup export writes a JSON snapshot with core Margin tables', async () => {
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

test('backup import restores a JSON snapshot into a fresh Margin database', async () => {
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
  delete process.env.SILICONFLOW_API_KEY;
  resetTtsProvider();

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
      delete process.env.SILICONFLOW_API_KEY;
      resetTtsProvider();
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function postJson(baseUrl, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
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

async function confirmGrowthFromMessage(baseUrl, message) {
  const reflect = await postJson(baseUrl, '/api/reflect', { message });
  const suggestion = reflect.result?.growth_suggestion;
  assert.ok(suggestion?.key, `expected growth suggestion for: ${message}`);
  return postJson(
    baseUrl,
    `/learning/suggestions/${encodeURIComponent(suggestion.key)}/confirm`,
    {}
  );
}
