import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginPiExtension, toPiToolResult } from '../src/runtime/pi/marginPiAdapter.js';

const toolNames = ['action_update', 'memory_propose', 'memory_search', 'state_update'];

function registerAdapter(options) {
  const registered = [];
  return createMarginPiExtension(options)({ registerTool: (tool) => registered.push(tool) })
    .then(() => registered);
}

test('registers exactly the four Margin Core tool names', async () => {
  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, async () => ({ ok: true, data: { name }, auditId: 'audit-1' })])),
    getInvocationContext: async () => ({ actorType: 'agent', permissions: {}, sourceSessionId: 'session-a', sourceEventId: 'event-a' })
  });

  assert.deepEqual(registered.map((tool) => tool.name).sort(), toolNames);
});

test('exposes closed model-facing contracts without host provenance or authorization fields', async () => {
  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, async () => ({ ok: true, data: {}, auditId: 'audit-1' })])),
    getInvocationContext: async () => null
  });

  for (const tool of registered) {
    assert.equal(tool.parameters.additionalProperties, false);
    for (const field of ['permissions', 'actorType', 'sourceSessionId', 'sourceEventId', 'confirmations']) {
      assert.equal(field in tool.parameters.properties, false, `${tool.name} must not expose ${field}`);
    }
  }
});

test('uses host context instead of model-supplied provenance and permissions', async () => {
  let observed;
  const registered = await registerAdapter({
    tools: {
      memory_search: async (input, context) => {
        observed = { input, context };
        return { ok: true, data: { items: [] }, auditId: 'audit-host' };
      },
      memory_propose: async () => ({ ok: true, data: {}, auditId: 'audit-1' }),
      state_update: async () => ({ ok: true, data: {}, auditId: 'audit-1' }),
      action_update: async () => ({ ok: true, data: {}, auditId: 'audit-1' })
    },
    getInvocationContext: async ({ toolName, toolCallId }) => ({
      actorType: 'user',
      permissions: { memoryRead: true },
      sourceSessionId: `host-${toolName}`,
      sourceEventId: `host-${toolCallId}`,
      confirmations: [{ ref: 'host-confirmation' }]
    })
  });
  const memorySearch = registered.find((tool) => tool.name === 'memory_search');

  await memorySearch.execute('call-7', {
    requestId: 'request-7', projectId: 'project-7', query: 'resume', asOf: '2026-08-20T00:00:00.000Z',
    sourceSessionId: 'model-session', sourceEventId: 'model-event', actorType: 'agent', permissions: { memoryRead: false },
    confirmations: []
  });

  assert.deepEqual(observed, {
    input: {
      requestId: 'request-7', projectId: 'project-7', query: 'resume', asOf: '2026-08-20T00:00:00.000Z',
      sourceSessionId: 'host-memory_search', sourceEventId: 'host-call-7', actorType: 'agent', permissions: { memoryRead: false }, confirmations: []
    },
    context: {
      actorType: 'user', permissions: { memoryRead: true }, confirmations: [{ ref: 'host-confirmation' }]
    }
  });
});

test('defaults missing host context to a deny-all agent context and tool-call event id', async () => {
  let observed;
  const registered = await registerAdapter({
    tools: {
      memory_search: async () => ({ ok: true, data: {}, auditId: 'audit-1' }),
      memory_propose: async () => ({ ok: true, data: {}, auditId: 'audit-1' }),
      state_update: async (input, context) => {
        observed = { input, context };
        return { ok: false, error: { code: 'permission_denied', retryable: false }, auditId: 'audit-denied' };
      },
      action_update: async () => ({ ok: true, data: {}, auditId: 'audit-1' })
    },
    getInvocationContext: async () => undefined
  });
  const stateUpdate = registered.find((tool) => tool.name === 'state_update');
  const result = await stateUpdate.execute('call-8', { requestId: 'request-8', projectId: 'project-8', operation: 'update_project' });

  assert.deepEqual(observed, {
    input: { requestId: 'request-8', projectId: 'project-8', operation: 'update_project', sourceSessionId: undefined, sourceEventId: 'call-8' },
    context: { actorType: 'agent', permissions: {}, confirmations: [] }
  });
  assert.deepEqual(result.details, { ok: false, auditId: 'audit-denied', code: 'permission_denied' });
  assert.equal(result.isError, true);
});

test('rejects a model project id outside the host-selected project', async () => {
  let called = false;
  const results = [];
  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, async () => { called = true; return { ok: true, data: {} }; }])),
    getInvocationContext: async () => ({ actorType: 'agent', projectId: 'selected-project', permissions: { memoryRead: true }, sourceSessionId: 'session' }),
    onToolResult: (result) => results.push(result)
  });
  const result = await registered.find((tool) => tool.name === 'memory_search').execute('call-scope', {
    requestId: 'request', projectId: 'forged-project', query: 'q', asOf: '2026-08-23T00:00:00.000Z'
  });
  assert.equal(called, false);
  assert.equal(result.details.code, 'cross_project_reference');
  assert.deepEqual(results, [{ toolName: 'memory_search', code: 'cross_project_reference', auditId: undefined }]);
});

test('reports the proposed memory identifier and version for host confirmation', async () => {
  const results = [];
  const registered = await registerAdapter({
    tools: {
      memory_search: async () => ({ ok: true, data: { items: [] }, auditId: 'audit-search' }),
      memory_propose: async () => ({
        ok: true,
        data: { memory: { id: 'memory-visible', version: 1 }, confirmationRequired: true },
        auditId: 'audit-propose'
      }),
      state_update: async () => ({ ok: true, data: {}, auditId: 'audit-state' }),
      action_update: async () => ({ ok: true, data: {}, auditId: 'audit-action' })
    },
    getInvocationContext: async () => ({ actorType: 'agent', projectId: 'project-1', permissions: { memoryWrite: true }, sourceSessionId: 'session-1' }),
    onToolResult: (result) => results.push(result)
  });

  await registered.find((tool) => tool.name === 'memory_propose').execute('call-propose', {
    requestId: 'request-1', projectId: 'project-1', content: '长期维护投递记录', memoryType: 'preference',
    confidence: 0.9, validFrom: '2026-08-23T00:00:00.000Z', durableIntent: true
  });

  assert.deepEqual(results, [{
    toolName: 'memory_propose', code: 'allowed', auditId: 'audit-propose',
    entityId: 'memory-visible', entityVersion: 1, confirmationRequired: true
  }]);
});

test('serializes concurrent Margin tool executions on the shared SQLite store', async () => {
  let active = 0;
  let maxActive = 0;
  const handler = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { ok: true, data: {}, auditId: 'audit-write' };
  };
  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, handler])),
    getInvocationContext: async () => ({ actorType: 'agent', permissions: {}, sourceSessionId: 'session-1' })
  });

  await Promise.all([
    registered.find((tool) => tool.name === 'state_update').execute('call-state', { requestId: 'r1', projectId: 'p1', operation: 'update_project' }),
    registered.find((tool) => tool.name === 'memory_propose').execute('call-memory', { requestId: 'r2', projectId: 'p1', content: 'c', memoryType: 'context', confidence: 1, validFrom: '2026-08-23T00:00:00.000Z', durableIntent: true })
  ]);

  assert.equal(maxActive, 1);
});

test('state tool description states operation-specific required fields', async () => {
  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, async () => ({ ok: true, data: {} })])),
    getInvocationContext: async () => ({})
  });
  const description = registered.find((tool) => tool.name === 'state_update').description;
  assert.match(description, /update_task requires taskId, expectedVersion, and non-empty changes/);
  assert.match(description, /currentStep/);
});

test('reports a content-free request shape when a tool call is rejected', async () => {
  const results = [];
  const registered = await registerAdapter({
    tools: {
      ...Object.fromEntries(toolNames.map((name) => [name, async () => ({ ok: true, data: {} })])),
      state_update: async () => ({ ok: false, error: { code: 'invalid_request' }, auditId: 'audit-invalid' })
    },
    getInvocationContext: async () => ({ actorType: 'agent', projectId: 'project-1', permissions: { stateWrite: true }, sourceSessionId: 'session-1' }),
    onToolResult: (result) => results.push(result)
  });

  await registered.find((tool) => tool.name === 'state_update').execute('call-invalid', {
    requestId: 'request-1', projectId: 'project-1', operation: 'update_task', taskId: 'task-1',
    expectedVersion: 1, changes: { current_step: 'must-not-leak' }
  });

  assert.deepEqual(results[0].requestShape, {
    operation: 'update_task', fields: ['changes', 'expectedVersion', 'operation', 'projectId', 'requestId', 'taskId'],
    changeFields: ['current_step'], hasTaskId: true, hasExpectedVersion: true
  });
  assert.doesNotMatch(JSON.stringify(results[0]), /must-not-leak/);
});

test('converts stable Core successes and errors to Pi results', () => {
  const success = toPiToolResult({ ok: true, data: { id: 'memory-1' }, auditId: 'audit-success' });
  const failure = toPiToolResult({ ok: false, error: { code: 'permission_denied', retryable: false }, auditId: 'audit-failure' });

  assert.deepEqual(success, {
    content: [{ type: 'text', text: '{"ok":true,"data":{"id":"memory-1"},"auditId":"audit-success"}' }],
    details: { ok: true, auditId: 'audit-success', code: 'allowed' }, isError: false
  });
  assert.deepEqual(failure, {
    content: [{ type: 'text', text: '{"ok":false,"error":{"code":"permission_denied","retryable":false},"auditId":"audit-failure"}' }],
    details: { ok: false, auditId: 'audit-failure', code: 'permission_denied' }, isError: true
  });
});

test('rejects oversized result output and never leaks raw handler exceptions', async () => {
  const oversized = toPiToolResult({ ok: true, data: { content: 'x'.repeat(32 * 1024) }, auditId: 'audit-large' });
  assert.deepEqual(JSON.parse(oversized.content[0].text), { ok: false, error: { code: 'adapter_output_too_large' }, auditId: 'audit-large' });
  assert.deepEqual(oversized.details, { ok: false, auditId: 'audit-large', code: 'adapter_output_too_large' });
  assert.equal(oversized.isError, true);

  const registered = await registerAdapter({
    tools: Object.fromEntries(toolNames.map((name) => [name, async () => { throw new Error('secret-token=never-return-this'); }])),
    getInvocationContext: async () => ({ actorType: 'agent', permissions: {}, sourceSessionId: 'host', sourceEventId: 'event' })
  });
  const result = await registered.find((tool) => tool.name === 'action_update').execute('call-9', { requestId: 'request-9', projectId: 'project-9', operation: 'create', title: 'draft' });

  assert.deepEqual(JSON.parse(result.content[0].text), { ok: false, error: { code: 'adapter_execution_failed' } });
  assert.equal(result.content[0].text.includes('secret-token'), false);
  assert.deepEqual(result.details, { ok: false, auditId: undefined, code: 'adapter_execution_failed' });
  assert.equal(result.isError, true);
});
