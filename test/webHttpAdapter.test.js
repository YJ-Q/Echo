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

function envelope(requestId, code = null) {
  return code
    ? { ok: false, error: { code, retryable: code === 'runtime_unavailable' || code === 'storage_failure' }, meta: { contractVersion: '1.0', requestId, correlationId: 'web-correlation' } }
    : { ok: true, data: { requestId }, meta: { contractVersion: '1.0', requestId, correlationId: 'web-correlation' } };
}

function gatewayFixture({ resultFor = () => null } = {}) {
  const calls = [];
  return {
    calls,
    gateway: {
      async execute(request) { calls.push(['execute', request]); return resultFor(request) ?? envelope(request.requestId); },
      async query(request) { calls.push(['query', request]); return resultFor(request) ?? envelope(request.requestId); },
      async events(request) { calls.push(['events', request]); return resultFor(request) ?? envelope(request.requestId); }
    }
  };
}

test('HTTP adapter routes native fetch command, query, and event requests through its injected gateway', async () => {
  const f = gatewayFixture();
  const app = createWebHttpAdapter({ webGateway: f.gateway });

  await withServer(app, async (origin) => {
    const commandResponse = await fetch(`${origin}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.create', requestId: 'command-1', idempotencyKey: 'key-1', payload: {} }) });
    const queryResponse = await fetch(`${origin}/api/queries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.list', requestId: 'query-1', payload: {} }) });
    const eventResponse = await fetch(`${origin}/api/events?type=event.list&requestId=event-1&payload=%7B%7D`);

    assert.equal(commandResponse.status, 200);
    assert.equal(queryResponse.status, 200);
    assert.equal(eventResponse.status, 200);
  });
  assert.deepEqual(f.calls.map(([method, request]) => [method, request.requestId]), [
    ['execute', 'command-1'], ['query', 'query-1'], ['events', 'event-1']
  ]);
});

test('HTTP adapter maps stable contract errors, preserves version metadata, and hides private error details', async () => {
  const expectedStatuses = {
    invalid_request: 400, permission_denied: 403, not_found: 404, version_conflict: 409,
    invalid_transition: 409, runtime_unavailable: 503, storage_failure: 500
  };
  const f = gatewayFixture({ resultFor: (request) => envelope(request.requestId, request.payload.code) });
  const app = createWebHttpAdapter({ webGateway: f.gateway });

  await withServer(app, async (origin) => {
    for (const [code, status] of Object.entries(expectedStatuses)) {
      const response = await fetch(`${origin}/api/queries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.list', requestId: code, payload: { code } }) });
      assert.equal(response.status, status, code);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.equal(body.meta.contractVersion, '1.0');
      assert.equal(JSON.stringify(body).includes('stack'), false);
    }
  });
});

test('HTTP adapter returns runtime_unavailable for interactions without a service and forwards interactions when injected', async () => {
  const f = gatewayFixture();
  await withServer(createWebHttpAdapter({ webGateway: f.gateway }), async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'runtime_unavailable');
  });

  const interactions = [];
  await withServer(createWebHttpAdapter({ webGateway: f.gateway, interactionService: { async handle(input) { interactions.push(input); return { ok: true, data: { text: 'safe' }, meta: { contractVersion: '1.0', requestId: 'interaction-1', correlationId: 'web-correlation' } }; } } }), async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'interaction-1', message: 'hello' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.text, 'safe');
  });
  assert.deepEqual(interactions, [{ requestId: 'interaction-1', message: 'hello' }]);
});

test('HTTP adapter source boundary keeps web files free of Core, storage, Pi, and legacy dependencies', async () => {
  const forbidden = /(?:repositories|sqlite|(?:^|[^a-z])pi(?:[^a-z]|$)|\.\.\/app\.js|legacy|\.\.\/storage\/memoryStore\.js)/i;
  const files = ['webCapabilities.js', 'webGateway.js', 'httpErrors.js', 'createWebHttpAdapter.js'];
  for (const file of files) {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL(`../src/http/${file}`, import.meta.url), 'utf8'));
    const imports = [...source.matchAll(/import(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.equal(imports.some((specifier) => forbidden.test(specifier)), false, file);
  }
});
