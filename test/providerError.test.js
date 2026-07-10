import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderError,
  isProviderError,
  providerErrorFromResponse,
  sanitizeProviderDetail
} from '../src/services/providers/providerError.js';
import { fetchWithTimeout } from '../src/services/providers/fetchWithTimeout.js';

test('classifies authentication failures without exposing configured keys', async () => {
  const response = new Response(JSON.stringify({
    error: { message: 'invalid key sk-test-secret' }
  }), {
    status: 401,
    headers: { 'x-request-id': 'req_123' }
  });

  const error = await providerErrorFromResponse('openai', response, ['sk-test-secret']);

  assert.equal(error instanceof ProviderError, true);
  assert.equal(error.code, 'provider_auth_failed');
  assert.equal(error.status, 502);
  assert.equal(error.upstreamStatus, 401);
  assert.equal(error.retryable, false);
  assert.equal(error.traceId, 'req_123');
  assert.equal(error.detail.includes('sk-test-secret'), false);
  assert.equal(error.detail.includes('[REDACTED]'), true);
});

test('classifies rate limits as retryable and captures SiliconFlow trace ids', async () => {
  const response = new Response('rate limited', {
    status: 429,
    headers: { 'x-siliconcloud-trace-id': 'sf_trace_123' }
  });

  const error = await providerErrorFromResponse('siliconflow', response);

  assert.equal(error.code, 'provider_rate_limited');
  assert.equal(error.retryable, true);
  assert.equal(error.traceId, 'sf_trace_123');
});

test('sanitizes bearer tokens, whitespace, and diagnostic length', () => {
  const detail = sanitizeProviderDetail(
    `  Bearer abcdefghijklmnopqrstuvwxyz\n${'x'.repeat(500)}  `,
    []
  );

  assert.equal(detail.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(detail.length, 300);
  assert.equal(detail.includes('\n'), false);
});

test('fetchWithTimeout converts aborts into a stable provider timeout', async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  const error = await captureError(() => fetchWithTimeout('https://example.test', {}, {
    provider: 'anthropic',
    timeoutMs: 5,
    fetchImpl
  }));

  assert.equal(isProviderError(error), true);
  assert.equal(error.code, 'provider_timeout');
  assert.equal(error.provider, 'anthropic');
  assert.equal(error.status, 504);
  assert.equal(error.retryable, true);
});

test('fetchWithTimeout converts transport failures without copying raw messages', async () => {
  const error = await captureError(() => fetchWithTimeout('https://example.test', {}, {
    provider: 'openai',
    fetchImpl: async () => {
      throw new Error('connect failed with sk-test-secret');
    }
  }));

  assert.equal(error.code, 'provider_request_failed');
  assert.equal(error.provider, 'openai');
  assert.equal(error.message.includes('sk-test-secret'), false);
});

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}
