import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import {
  STT_DEFAULTS,
  SttProviderError,
  buildSttConfig,
  createSttProvider
} from '../src/services/sttProvider.js';

test('buildSttConfig uses SiliconFlow defaults and env overrides', () => {
  const config = buildSttConfig({
    STT_PROVIDER: ' siliconflow ',
    SILICONFLOW_API_KEY: 'test-key',
    STT_BASE_URL: 'https://example.com/transcriptions',
    STT_MODEL: 'custom-model',
    SILICONFLOW_STT_LANGUAGE: 'zh'
  });

  assert.deepEqual(config, {
    name: STT_DEFAULTS.provider,
    apiKey: 'test-key',
    base_url: 'https://example.com/transcriptions',
    model: 'custom-model',
    language: 'zh'
  });
});

test('buildSttConfig falls back to the centralized default model', () => {
  const config = buildSttConfig({
    SILICONFLOW_API_KEY: 'test-key'
  });

  assert.equal(config.model, STT_DEFAULTS.model);
  assert.equal(config.base_url, STT_DEFAULTS.base_url);
  assert.equal(config.language, STT_DEFAULTS.language);
});

test('stt provider posts multipart form data for buffer input', async () => {
  const calls = [];
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ text: '  Hello, Margin!\r\n' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const result = await provider.transcribe(Buffer.from('hello world'), {
    filename: 'clip.wav',
    mimeType: 'audio/wav'
  });

  assert.equal(result, 'Hello, Margin!');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, STT_DEFAULTS.base_url);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].options.body instanceof FormData, true);
  assert.equal(calls[0].options.body.has('language'), false);

  const filePart = calls[0].options.body.get('file');
  assert.equal(filePart.name, 'clip.wav');
  assert.equal(filePart.type, 'audio/wav');
  assert.equal(Buffer.from(await filePart.arrayBuffer()).toString('utf8'), 'hello world');
  assert.equal(calls[0].options.body.get('model'), STT_DEFAULTS.model);
});

test('stt provider reads filename input from disk and sends language', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'stt-provider-'));
  const audioPath = path.join(tempDir, 'sample.webm');
  await writeFile(audioPath, Buffer.from([1, 2, 3, 4]));

  try {
    const calls = [];
    const provider = createSttProvider({
      env: {
        SILICONFLOW_API_KEY: 'test-key',
        SILICONFLOW_STT_LANGUAGE: 'zh'
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ text: 'Margin transcription' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    const result = await provider.transcribe(audioPath);

    assert.equal(result, 'Margin transcription');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.body.has('language'), true);
    assert.equal(calls[0].options.body.get('language'), 'zh');
    assert.equal(calls[0].options.body.get('model'), STT_DEFAULTS.model);

    const filePart = calls[0].options.body.get('file');
    assert.equal(filePart.name, 'sample.webm');
    assert.equal(filePart.type, 'audio/webm');
    assert.deepEqual(new Uint8Array(await filePart.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('stt provider rejects missing API keys with a stable error', async () => {
  const provider = createSttProvider({
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_missing_api_key');
  assert.equal(error.status, 503);
  assert.match(error.message, /not configured/);
});

test('stt provider rejects non-2xx responses with a stable error', async () => {
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () =>
      new Response('upstream error', {
        status: 429,
        headers: { 'content-type': 'text/plain' }
      })
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_http_error');
  assert.equal(error.status, 502);
  assert.equal(error.message, 'STT request failed with HTTP status 429');
});

test('stt provider rejects invalid JSON with a stable error', async () => {
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_invalid_json');
  assert.equal(error.status, 502);
  assert.equal(error.message, 'STT response was not valid JSON');
});

test('stt provider rejects empty transcript text with a stable error', async () => {
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () =>
      new Response(JSON.stringify({ text: '   ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_empty_text');
  assert.equal(error.status, 502);
  assert.equal(error.message, 'STT response did not contain transcript text');
});

test('stt provider maps AbortError to a stable error', async () => {
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_request_aborted');
  assert.equal(error.status, 504);
  assert.equal(error.message, 'STT request was aborted or timed out');
});

test('stt provider maps TimeoutError to the same stable error', async () => {
  const provider = createSttProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }
  });

  const error = await captureError(() => provider.transcribe(Buffer.from('test')));

  assert.equal(error instanceof SttProviderError, true);
  assert.equal(error.code, 'stt_request_aborted');
  assert.equal(error.status, 504);
  assert.equal(error.message, 'STT request was aborted or timed out');
});

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }

  assert.fail('Expected the operation to throw');
}
