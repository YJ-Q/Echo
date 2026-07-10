import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MASKED_SECRET,
  createSettingsStore
} from '../electron/settingsStore.js';

function createSafeStorage() {
  const calls = {
    encrypt: [],
    decrypt: []
  };

  return {
    calls,
    safeStorage: {
      encryptString(value) {
        calls.encrypt.push(value);
        return Buffer.from(`encrypted:${value}`, 'utf8');
      },
      decryptString(buffer) {
        const encoded = Buffer.from(buffer).toString('utf8');
        calls.decrypt.push(encoded);
        return encoded.slice('encrypted:'.length);
      }
    }
  };
}

test('loads default settings with light reading off and masked api keys', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-settings-defaults-'));
  const { safeStorage } = createSafeStorage();

  try {
    const store = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await store.load();

    const snapshot = store.getSnapshot();

    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.lightReadingEnabled, false);
    assert.deepEqual(snapshot.appearance, {
      fontScale: 1,
      lineHeight: 1,
      motion: 'full'
    });
    assert.equal(snapshot.conversation.provider, 'local');
    assert.equal(snapshot.conversation.model, '');
    assert.deepEqual(snapshot.conversation.apiKeys.openai, {
      configured: false,
      masked: null
    });
    assert.deepEqual(snapshot.conversation.apiKeys.anthropic, {
      configured: false,
      masked: null
    });
    assert.deepEqual(snapshot.conversation.apiKeys.siliconflow, {
      configured: false,
      masked: null
    });
    assert.equal(snapshot.speech.provider, 'siliconflow');
    assert.deepEqual(snapshot.speech.tts, {
      baseUrl: 'https://api.siliconflow.cn/v1/audio/speech',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
      responseFormat: 'mp3',
      speed: 1
    });
    assert.deepEqual(snapshot.speech.stt, {
      baseUrl: 'https://api.siliconflow.cn/v1/audio/transcriptions',
      model: 'FunAudioLLM/SenseVoiceSmall',
      language: 'zh',
      prompt: '',
      responseFormat: 'json',
      temperature: 0
    });

    const env = store.buildBackendEnv({ EXISTING: '1' });

    assert.equal(env.EXISTING, '1');
    assert.equal(env.MARGIN_LLM_PROVIDER, 'local');
    assert.equal(env.MARGIN_LIGHT_READING_ENABLED, 'false');
    assert.equal(env.TTS_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_TTS_PROVIDER, 'siliconflow');
    assert.equal(env.STT_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_STT_PROVIDER, 'siliconflow');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('encrypts api keys on disk, restores them on load, and only exposes masked status', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-settings-keys-'));
  const { safeStorage, calls } = createSafeStorage();

  try {
    const store = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await store.load();

    const result = await store.updateSettings({
      conversation: {
        provider: 'openai'
      }
    });

    assert.equal(result.previousSnapshot.conversation.provider, 'local');
    assert.equal(result.snapshot.conversation.provider, 'openai');

    const updateResult = await store.setConversationApiKey('openai', 'sk-test-secret');
    const snapshot = store.getSnapshot();

    assert.equal(updateResult.previousSnapshot.conversation.apiKeys.openai.configured, false);
    assert.equal(snapshot.conversation.apiKeys.openai.configured, true);
    assert.equal(snapshot.conversation.apiKeys.openai.masked, MASKED_SECRET);
    assert.equal(JSON.stringify(snapshot).includes('sk-test-secret'), false);
    assert.equal(JSON.stringify(snapshot).includes('encrypted:sk-test-secret'), false);

    const fileContents = await readFile(store.getSettingsFilePath(), 'utf8');
    assert.equal(fileContents.includes('sk-test-secret'), false);
    assert.equal(fileContents.includes('encrypted:sk-test-secret'), false);

    const reloadedStore = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await reloadedStore.load();

    const reloadedSnapshot = reloadedStore.getSnapshot();

    assert.equal(reloadedSnapshot.conversation.apiKeys.openai.configured, true);
    assert.equal(reloadedSnapshot.conversation.apiKeys.openai.masked, MASKED_SECRET);
    assert.equal(JSON.stringify(reloadedSnapshot).includes('sk-test-secret'), false);
    assert.ok(calls.encrypt.length >= 1);
    assert.ok(calls.decrypt.length >= 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('persists updated settings and preserves the previous snapshot for rollback', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-settings-persist-'));
  const { safeStorage } = createSafeStorage();

  try {
    const store = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await store.load();

    const updateResult = await store.updateSettings({
      lightReadingEnabled: true,
      conversation: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKeys: {
          anthropic: 'anthropic-secret'
        }
      },
      speech: {
        tts: {
          baseUrl: 'https://tts.example.com',
          model: 'voice-model',
          voice: 'narrator',
          responseFormat: 'wav',
          speed: 1.25
        },
        stt: {
          baseUrl: 'https://stt.example.com',
          model: 'stt-model',
          language: 'en',
          prompt: 'Be concise',
          responseFormat: 'json',
          temperature: 0.2
        }
      }
    });

    assert.equal(updateResult.previousSnapshot.lightReadingEnabled, false);
    assert.equal(updateResult.snapshot.lightReadingEnabled, true);
    assert.equal(updateResult.snapshot.conversation.provider, 'anthropic');
    assert.equal(updateResult.snapshot.conversation.apiKeys.anthropic.configured, true);
    assert.equal(store.getPreviousSnapshot().lightReadingEnabled, false);

    const reloadedStore = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await reloadedStore.load();

    const reloadedSnapshot = reloadedStore.getSnapshot();

    assert.equal(reloadedSnapshot.lightReadingEnabled, true);
    assert.equal(reloadedSnapshot.conversation.provider, 'anthropic');
    assert.equal(reloadedSnapshot.conversation.model, 'claude-3-5-sonnet-20241022');
    assert.equal(reloadedSnapshot.conversation.apiKeys.anthropic.configured, true);
    assert.equal(reloadedSnapshot.speech.tts.baseUrl, 'https://tts.example.com');
    assert.equal(reloadedSnapshot.speech.tts.model, 'voice-model');
    assert.equal(reloadedSnapshot.speech.tts.voice, 'narrator');
    assert.equal(reloadedSnapshot.speech.tts.responseFormat, 'wav');
    assert.equal(reloadedSnapshot.speech.tts.speed, 1.25);
    assert.equal(reloadedSnapshot.speech.stt.baseUrl, 'https://stt.example.com');
    assert.equal(reloadedSnapshot.speech.stt.model, 'stt-model');
    assert.equal(reloadedSnapshot.speech.stt.language, 'en');
    assert.equal(reloadedSnapshot.speech.stt.prompt, 'Be concise');
    assert.equal(reloadedSnapshot.speech.stt.responseFormat, 'json');
    assert.equal(reloadedSnapshot.speech.stt.temperature, 0.2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('builds backend env with conversation keys and speech parameters', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-settings-env-'));
  const { safeStorage } = createSafeStorage();

  try {
    const store = createSettingsStore({
      userDataPath: tempDir,
      safeStorage
    });

    await store.load();

    await store.updateSettings({
      lightReadingEnabled: true,
      conversation: {
        provider: 'siliconflow',
        model: 'qwen-plus',
        apiKeys: {
          openai: 'openai-secret',
          anthropic: 'anthropic-secret',
          siliconflow: 'siliconflow-secret'
        }
      },
      speech: {
        provider: 'siliconflow',
        tts: {
          baseUrl: 'https://example.com/tts',
          model: 'tts-model',
          voice: 'voice-a',
          responseFormat: 'opus',
          speed: 0.9
        },
        stt: {
          baseUrl: 'https://example.com/stt',
          model: 'stt-model',
          language: 'zh',
          prompt: 'Transcribe exactly',
          responseFormat: 'json',
          temperature: 0.1
        }
      }
    });

    const env = store.buildBackendEnv({ ROOT: 'present' });

    assert.equal(env.ROOT, 'present');
    assert.equal(env.MARGIN_LIGHT_READING_ENABLED, 'true');
    assert.equal(env.MARGIN_LLM_PROVIDER, 'siliconflow');
    assert.equal(env.MARGIN_LLM_MODEL, 'qwen-plus');
    assert.equal(env.OPENAI_API_KEY, 'openai-secret');
    assert.equal(env.ANTHROPIC_API_KEY, 'anthropic-secret');
    assert.equal(env.SILICONFLOW_API_KEY, 'siliconflow-secret');
    assert.equal(env.TTS_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_TTS_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_TTS_BASE_URL, 'https://example.com/tts');
    assert.equal(env.SILICONFLOW_TTS_MODEL, 'tts-model');
    assert.equal(env.SILICONFLOW_TTS_VOICE, 'voice-a');
    assert.equal(env.SILICONFLOW_TTS_RESPONSE_FORMAT, 'opus');
    assert.equal(env.SILICONFLOW_TTS_SPEED, '0.9');
    assert.equal(env.STT_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_STT_PROVIDER, 'siliconflow');
    assert.equal(env.SILICONFLOW_STT_BASE_URL, 'https://example.com/stt');
    assert.equal(env.SILICONFLOW_STT_MODEL, 'stt-model');
    assert.equal(env.SILICONFLOW_STT_LANGUAGE, 'zh');
    assert.equal(env.SILICONFLOW_STT_PROMPT, 'Transcribe exactly');
    assert.equal(env.SILICONFLOW_STT_RESPONSE_FORMAT, 'json');
    assert.equal(env.SILICONFLOW_STT_TEMPERATURE, '0.1');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('rolls back preferences and encrypted secrets after a failed apply', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-settings-rollback-'));
  const { safeStorage } = createSafeStorage();

  try {
    const store = createSettingsStore({ userDataPath: tempDir, safeStorage });
    await store.load();
    await store.updateSettings({
      lightReadingEnabled: true,
      appearance: { fontScale: 1.12, motion: 'reduced' },
      conversation: { provider: 'openai', apiKeys: { openai: 'first-secret' } }
    });
    await store.updateSettings({
      lightReadingEnabled: false,
      conversation: { provider: 'local', apiKeys: { openai: 'second-secret' } }
    });

    const restored = await store.rollbackLastUpdate();
    assert.equal(restored.lightReadingEnabled, true);
    assert.equal(restored.appearance.fontScale, 1.12);
    assert.equal(restored.appearance.motion, 'reduced');
    assert.equal(restored.conversation.provider, 'openai');
    assert.equal(store.buildBackendEnv({}).OPENAI_API_KEY, 'first-secret');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
