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

  await withServer(createWebHttpAdapter({ webGateway: f.gateway }), async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: { type: 'user' }, requestId: 'forged-interaction', message: 'hello' }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  });

  const interactions = [];
  await withServer(createWebHttpAdapter({ webGateway: f.gateway, interactionService: { async handle(input) { interactions.push(input); return { ok: true, data: { text: 'safe' }, meta: { contractVersion: '1.0', requestId: 'interaction-1', correlationId: 'web-correlation' } }; } } }), async (origin) => {
    const response = await fetch(`${origin}/api/interactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'interaction-1', message: 'hello' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.text, 'safe');
  });
  assert.deepEqual(interactions, [{ requestId: 'interaction-1', message: 'hello' }]);
});

test('HTTP adapter converts injected middleware errors to sanitized storage failures', async () => {
  const f = gatewayFixture();
  const assertFailure = async (app) => withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/queries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.list', requestId: 'middleware-request', payload: {} }) });
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    assert.deepEqual(body.error, { code: 'storage_failure', retryable: true });
    assert.equal(JSON.stringify(body).includes('middleware private detail'), false);
  });

  await assertFailure(createWebHttpAdapter({ webGateway: f.gateway, viteMiddleware: (request, response, next) => {
    response.write('middleware private detail');
    response.end('middleware private detail');
    next(new Error('middleware private detail'));
  } }));
  await assertFailure(createWebHttpAdapter({ webGateway: f.gateway, staticDir: () => { throw new Error('middleware private detail'); } }));
});

test('injected middleware retains native response methods while buffered headers are recoverable', async () => {
  const f = gatewayFixture();
  const app = createWebHttpAdapter({
    webGateway: f.gateway,
    viteMiddleware: (request, response, next) => {
      assert.equal(typeof response.on, 'function');
      assert.equal(typeof response.once, 'function');
      assert.equal(typeof response.getHeaders, 'function');
      assert.equal(typeof response.flushHeaders, 'function');
      assert.equal(typeof response.locals, 'object');
      response.locals.middlewareChecked = true;
      response.on('finish', () => {});
      response.once('close', () => {});
      assert.equal(response.writeHead(201, 'Created', { 'x-buffered-middleware': 'yes' }), response);
      assert.equal(response.statusCode, 201);
      assert.equal(response.getHeaders()['x-buffered-middleware'], 'yes');
      response.flushHeaders();
      next();
    }
  });

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/queries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.list', requestId: 'native-response', payload: {} }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-buffered-middleware'), null);
    assert.equal((await response.json()).data.requestId, 'native-response');
  });
});

test('GET events rejects forbidden and unknown URL query parameters before dispatch', async () => {
  const f = gatewayFixture();
  const app = createWebHttpAdapter({ webGateway: f.gateway });
  await withServer(app, async (origin) => {
    for (const key of ['actor', 'capabilities', 'databasePath', 'hostAuthority', 'unexpected']) {
      const response = await fetch(`${origin}/api/events?type=event.list&requestId=event-${key}&payload=%7B%7D&${key}=forged`);
      assert.equal(response.status, 400, key);
      assert.equal((await response.json()).error.code, 'invalid_request', key);
    }
  });
  assert.equal(f.calls.length, 0);
});

test('HTTP adapter removes nested Pi and reasoning internals from browser output', async () => {
  const f = gatewayFixture({ resultFor: (request) => request.payload.leak
    ? { ok: true, data: { safe: 'visible', nested: { piSession: 'secret', piConfig: { token: 'secret' }, piCredentials: 'secret', piEnvironment: 'secret', piRequest: 'secret', reasoningTrace: 'secret' } }, meta: { contractVersion: '1.0', requestId: request.requestId, correlationId: 'web-correlation' } }
    : null });
  await withServer(createWebHttpAdapter({ webGateway: f.gateway }), async (origin) => {
    const response = await fetch(`${origin}/api/queries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'workstream.list', requestId: 'private-output', payload: { leak: true } }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, { safe: 'visible', nested: {} });
    assert.equal(JSON.stringify(body).includes('secret'), false);
  });
});

test('GET events malformed payload returns invalid_request without a fabricated stack field', async () => {
  const f = gatewayFixture();
  await withServer(createWebHttpAdapter({ webGateway: f.gateway }), async (origin) => {
    const response = await fetch(`${origin}/api/events?type=event.list&requestId=malformed-event&payload=%7B`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  });
  assert.equal(f.calls.length, 0);
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/http/createWebHttpAdapter.js', import.meta.url), 'utf8'));
  assert.equal(source.includes("payload: { stack: 'invalid' }"), false);
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
