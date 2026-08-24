import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../web/src/apiClient.js';

function jsonResponse(body) {
  return { async json() { return body; } };
}

test('API client sends only browser-safe command data and keeps stable error fields', async () => {
  const requests = [];
  const api = createApiClient({
    baseUrl: 'https://echo.test/',
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return jsonResponse({
        ok: false,
        error: {
          code: 'version_conflict', retryable: false, message: 'private detail', stack: 'private stack',
          details: { currentVersion: 7, stack: 'private stack' }
        },
        meta: { contractVersion: '1.0', requestId: 'command-1', correlationId: 'correlation-1' }
      });
    }
  });

  const result = await api.command('workstream.update', {
    workstreamId: 'ws-1', actor: { type: 'admin' }, nested: { capabilities: ['all'], PiToken: 'secret', title: 'safe' }
  }, { requestId: 'command-1', idempotencyKey: 'intent-1', expectedVersion: 6 });

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'version_conflict', retryable: false, currentVersion: 7 },
    meta: { contractVersion: '1.0', requestId: 'command-1', correlationId: 'correlation-1' }
  });
  assert.equal(requests[0].url, 'https://echo.test/api/commands');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    type: 'workstream.update', requestId: 'command-1', idempotencyKey: 'intent-1', expectedVersion: 6,
    payload: { workstreamId: 'ws-1', nested: { title: 'safe' } }
  });
  assert.equal(JSON.stringify(requests[0]).includes('secret'), false);
  assert.equal(JSON.stringify(requests[0]).includes('private detail'), false);
});

test('API client generates request IDs, uses each public route, and converts transport failures', async () => {
  const requests = [];
  const api = createApiClient({
    baseUrl: '/root/',
    async fetchImpl(url, options) {
      requests.push({ url, options });
      if (url.includes('/api/events')) return jsonResponse({ ok: true, data: { items: [] }, meta: { contractVersion: '1.0' } });
      if (url.includes('/api/interactions')) throw new Error('network unavailable');
      return jsonResponse({ ok: true, data: { items: [] }, meta: { contractVersion: '1.0' } });
    }
  });

  const query = await api.query('workstream.list', {});
  const events = await api.events('event.list', { afterCursor: 0, capabilities: ['forged'] });
  const interaction = await api.interact({ message: 'continue', databasePath: 'private' });

  assert.match(query.meta.requestId, /^web_query_/);
  assert.match(events.meta.requestId, /^web_events_/);
  assert.equal(requests[0].url, '/root/api/queries');
  assert.match(requests[1].url, /^\/root\/api\/events\?type=event\.list&requestId=web_events_/);
  assert.equal(requests[1].url.includes('capabilities'), false);
  assert.deepEqual(JSON.parse(requests[2].options.body), { requestId: interaction.meta.requestId, message: 'continue' });
  assert.deepEqual(interaction.error, { code: 'transport_unavailable', retryable: true });
});
