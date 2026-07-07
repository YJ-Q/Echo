import test from 'node:test';
import assert from 'node:assert/strict';
import { createTtsProvider } from '../src/services/ttsProvider.js';

test('createTtsProvider returns null when SILICONFLOW_API_KEY is not configured', () => {
  const originalKey = process.env.SILICONFLOW_API_KEY;
  delete process.env.SILICONFLOW_API_KEY;

  try {
    assert.equal(createTtsProvider(), null);
  } finally {
    restoreEnv('SILICONFLOW_API_KEY', originalKey);
  }
});

test('tts provider rejects empty audio payloads', async () => {
  const originalKey = process.env.SILICONFLOW_API_KEY;
  const originalFetch = global.fetch;
  process.env.SILICONFLOW_API_KEY = 'test-key';

  global.fetch = async () => new Response(new Uint8Array(0), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  });

  try {
    const provider = createTtsProvider();
    await assert.rejects(
      () => provider.synthesize('test'),
      /empty audio payload/
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv('SILICONFLOW_API_KEY', originalKey);
  }
});

test('tts provider rejects JSON success payloads that are not audio', async () => {
  const originalKey = process.env.SILICONFLOW_API_KEY;
  const originalFetch = global.fetch;
  process.env.SILICONFLOW_API_KEY = 'test-key';

  global.fetch = async () => new Response(JSON.stringify({ error: 'quota exceeded' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  try {
    const provider = createTtsProvider();
    await assert.rejects(
      () => provider.synthesize('test'),
      /returned JSON instead of audio/
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv('SILICONFLOW_API_KEY', originalKey);
  }
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
