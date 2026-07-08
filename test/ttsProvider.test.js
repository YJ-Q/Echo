import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTtsConfig, createTtsProvider } from '../src/services/ttsProvider.js';
import { TtsProviderError } from '../src/services/ttsErrors.js';

test('createTtsProvider returns null when SILICONFLOW_API_KEY is not configured', () => {
  assert.equal(createTtsProvider({ env: {} }), null);
});

test('buildTtsConfig uses SiliconFlow defaults', () => {
  const config = buildTtsConfig({
    SILICONFLOW_API_KEY: 'test-key'
  });

  assert.deepEqual(config, {
    name: 'siliconflow',
    apiKey: 'test-key',
    base_url: 'https://api.siliconflow.cn/v1/audio/speech',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    response_format: 'mp3',
    speed: 1
  });
});

test('buildTtsConfig falls back to default speed when speed is invalid', () => {
  const config = buildTtsConfig({
    SILICONFLOW_API_KEY: 'test-key',
    SILICONFLOW_TTS_SPEED: 'fast'
  });

  assert.equal(config.speed, 1);
});

test('tts provider uses env overrides in provider metadata and synthesize request', async () => {
  const calls = [];
  const provider = createTtsProvider({
    env: {
      SILICONFLOW_API_KEY: 'test-key',
      SILICONFLOW_TTS_BASE_URL: 'https://example.com/tts',
      SILICONFLOW_TTS_MODEL: 'custom-model',
      SILICONFLOW_TTS_VOICE: 'custom-voice',
      SILICONFLOW_TTS_RESPONSE_FORMAT: 'wav',
      SILICONFLOW_TTS_SPEED: '1.25'
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' }
      });
    }
  });

  assert.deepEqual(
    {
      name: provider.name,
      model: provider.model,
      voice: provider.voice,
      response_format: provider.response_format,
      base_url: provider.base_url,
      speed: provider.speed
    },
    {
      name: 'siliconflow',
      model: 'custom-model',
      voice: 'custom-voice',
      response_format: 'wav',
      base_url: 'https://example.com/tts',
      speed: 1.25
    }
  );

  const result = await provider.synthesize('test input');

  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(result.data, Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/tts');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'custom-model',
    input: 'test input',
    voice: 'custom-voice',
    response_format: 'wav',
    speed: 1.25
  });
});

test('tts provider rejects empty audio payloads', async () => {
  const provider = createTtsProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => new Response(new Uint8Array(0), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' }
    })
  });

  const error = await captureError(() => provider.synthesize('test'));

  assert.equal(error instanceof TtsProviderError, true);
  assert.equal(error.code, 'tts_empty_audio');
  assert.equal(error.status, 502);
  assert.match(error.message, /empty audio payload/);
});

test('tts provider rejects JSON success payloads that are not audio', async () => {
  const provider = createTtsProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => new Response(JSON.stringify({ error: 'quota exceeded' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  const error = await captureError(() => provider.synthesize('test'));

  assert.equal(error instanceof TtsProviderError, true);
  assert.equal(error.code, 'tts_provider_json_response');
  assert.equal(error.status, 502);
  assert.match(error.message, /returned JSON instead of audio/);
});

test('tts provider surfaces stable metadata for non-2xx responses', async () => {
  const provider = createTtsProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => new Response('upstream error', {
      status: 429,
      headers: { 'content-type': 'text/plain' }
    })
  });

  const error = await captureError(() => provider.synthesize('test'));

  assert.equal(error instanceof TtsProviderError, true);
  assert.equal(error.code, 'tts_provider_http_error');
  assert.equal(error.status, 502);
  assert.match(error.message, /429/);
});

test('tts provider wraps fetch failures with a stable error code', async () => {
  const provider = createTtsProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => {
      throw new Error('socket hang up');
    }
  });

  const error = await captureError(() => provider.synthesize('test'));

  assert.equal(error instanceof TtsProviderError, true);
  assert.equal(error.code, 'tts_provider_request_failed');
  assert.equal(error.status, 502);
  assert.match(error.message, /socket hang up/);
});

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }

  assert.fail('Expected the operation to throw');
}
