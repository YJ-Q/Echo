import test from 'node:test';
import assert from 'node:assert/strict';
import { probeProvider } from '../src/services/providerProbeService.js';
import { isProviderError } from '../src/services/providers/providerError.js';

test('probes OpenAI conversation without returning generated content', async () => {
  const result = await probeProvider({
    capability: 'conversation',
    provider: 'openai',
    env: { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test' },
    fetchImpl: async () => new Response(JSON.stringify({
      model: 'gpt-test',
      choices: [{ message: { content: 'MARGIN_OK' } }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_probe' }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.capability, 'conversation');
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-test');
  assert.equal(result.traceId, 'req_probe');
  assert.equal(Number.isFinite(result.latencyMs), true);
  assert.equal('text' in result, false);
});

test('probes SiliconFlow TTS without returning audio', async () => {
  const result = await probeProvider({
    capability: 'tts',
    provider: 'siliconflow',
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'x-siliconcloud-trace-id': 'tts_probe' }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.capability, 'tts');
  assert.equal(result.provider, 'siliconflow');
  assert.equal(result.traceId, 'tts_probe');
  assert.equal('audio' in result, false);
});

test('probes SiliconFlow STT from provided audio without returning transcription', async () => {
  const result = await probeProvider({
    capability: 'stt',
    provider: 'siliconflow',
    audio: Buffer.from('test audio'),
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => new Response(JSON.stringify({ text: 'Margin' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.capability, 'stt');
  assert.equal(result.provider, 'siliconflow');
  assert.equal('text' in result, false);
  assert.equal('transcript' in result, false);
});

test('probe rejects missing credentials without local fallback', async () => {
  const error = await captureError(() => probeProvider({
    capability: 'conversation',
    provider: 'anthropic',
    env: {},
    fetchImpl: async () => assert.fail('fetch must not run')
  }));

  assert.equal(isProviderError(error), true);
  assert.equal(error.code, 'provider_not_configured');
  assert.equal(error.provider, 'anthropic');
});

test('probe rejects unsupported capability and provider pairs', async () => {
  const error = await captureError(() => probeProvider({
    capability: 'tts',
    provider: 'openai',
    env: { OPENAI_API_KEY: 'test-key' }
  }));

  assert.equal(error.code, 'provider_probe_unsupported');
  assert.equal(error.status, 400);
});

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}
