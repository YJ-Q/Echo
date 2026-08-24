import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createWebHttpAdapter } from '../src/http/createWebHttpAdapter.js';

async function withServer(app, action) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function gateway() {
  return {
    async execute() { throw new Error('unused'); },
    async query() { throw new Error('unused'); },
    async events() { throw new Error('unused'); }
  };
}

test('interaction HTTP accepts only its closed bounded request and submits it exactly once', async () => {
  const calls = [];
  const app = createWebHttpAdapter({
    webGateway: gateway(),
    interactionService: {
      async submit(input) {
        calls.push(input);
        return {
          message: 'Safe response',
          toolResults: [{ toolName: 'action_update', code: 'allowed', auditId: 'audit-1', prompt: 'private' }],
          workstream: { id: 'ws-1', title: 'Current' },
          run: { id: 'run-1', status: 'running', runtime: { session: 'private' } },
          events: { nextCursor: 7 }
        };
      }
    }
  });

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workstreamId: 'ws-1', runId: 'run-1', message: 'Continue', requestId: 'turn-1' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.meta.requestId, 'turn-1');
    assert.deepEqual(body.data.toolResults, [{ toolName: 'action_update', code: 'allowed', auditId: 'audit-1' }]);
    assert.equal(JSON.stringify(body).includes('private'), false);
  });
  assert.deepEqual(calls, [{ workstreamId: 'ws-1', runId: 'run-1', message: 'Continue', requestId: 'turn-1' }]);
});

test('interaction HTTP rejects missing, overlong, trusted, and unknown request fields before the service', async () => {
  let calls = 0;
  const app = createWebHttpAdapter({ webGateway: gateway(), interactionService: { async submit() { calls += 1; return {}; } } });
  const invalidBodies = [
    { workstreamId: 'ws-1', runId: 'run-1', message: 'Continue' },
    { workstreamId: 'ws-1', runId: 'run-1', message: 'x'.repeat(2001), requestId: 'long' },
    { workstreamId: 'ws-1', runId: 'run-1', message: 'Continue', requestId: 'forged', runtime: { session: 'private' } },
    { workstreamId: 'ws-1', runId: 'run-1', message: 'Continue', requestId: 'unknown', extra: 'not accepted' }
  ];

  await withServer(app, async (origin) => {
    for (const body of invalidBodies) {
      const response = await fetch(`${origin}/api/interactions`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'invalid_request');
    }
  });
  assert.equal(calls, 0);
});

test('interaction HTTP maps stable service failures without exposing internals', async () => {
  const app = createWebHttpAdapter({
    webGateway: gateway(),
    interactionService: { async submit() { return { error: { code: 'run_not_running', stack: 'private stack' } }; } }
  });

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workstreamId: 'ws-1', runId: 'run-1', message: 'Continue', requestId: 'turn-failure' })
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.deepEqual(body.error, { code: 'run_not_running', retryable: false });
    assert.equal(JSON.stringify(body).includes('private'), false);
  });
});
