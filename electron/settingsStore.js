import * as fs from 'node:fs/promises';
import path from 'node:path';

export const SETTINGS_FILE_NAME = 'margin-settings.json';
export const SETTINGS_BACKUP_SUFFIX = '.bak';
export const SETTINGS_VERSION = 1;
export const MASKED_SECRET = '********';

export const CONVERSATION_PROVIDERS = Object.freeze(['local', 'openai', 'anthropic', 'siliconflow']);
export const SPEECH_PROVIDERS = Object.freeze(['siliconflow']);

const DEFAULT_TTS_SETTINGS = Object.freeze({
  baseUrl: 'https://api.siliconflow.cn/v1/audio/speech',
  model: 'FunAudioLLM/CosyVoice2-0.5B',
  voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
  responseFormat: 'mp3',
  speed: 1
});

const DEFAULT_STT_SETTINGS = Object.freeze({
  baseUrl: 'https://api.siliconflow.cn/v1/audio/transcriptions',
  model: 'FunAudioLLM/SenseVoiceSmall',
  language: 'zh',
  prompt: '',
  responseFormat: 'json',
  temperature: 0
});

export function createDefaultSettings() {
  return {
    version: SETTINGS_VERSION,
    lightReadingEnabled: false,
    appearance: {
      fontScale: 1,
      lineHeight: 1,
      motion: 'full'
    },
    conversation: {
      provider: 'local',
      model: '',
      apiKeys: createEmptyApiKeyState()
    },
    speech: {
      provider: 'siliconflow',
      tts: { ...DEFAULT_TTS_SETTINGS },
      stt: { ...DEFAULT_STT_SETTINGS }
    }
  };
}

export function createSettingsStore(options = {}) {
  const settingsFilePath = resolveSettingsFilePath(options);
  const backupFilePath = `${settingsFilePath}${SETTINGS_BACKUP_SUFFIX}`;
  const safeStorage = options.safeStorage ?? null;
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;

  let loaded = false;
  let loadPromise = null;
  let state = null;
  let lastPersistedSnapshot = null;
  let lastPersistedState = null;

  async function load() {
    if (loaded) {
      return getSnapshot();
    }

    if (!loadPromise) {
      loadPromise = (async () => {
        const persistedDocument = await readPersistedDocument(fsImpl, settingsFilePath, backupFilePath);
        state = persistedDocument
          ? deserializeSettingsDocument(persistedDocument.document, safeStorage)
          : createDefaultSettings();
        if (persistedDocument && persistedDocument.source === 'backup') {
          await restorePrimaryFromBackup(fsImpl, settingsFilePath, backupFilePath).catch(() => {});
        }
        loaded = true;
        lastPersistedSnapshot = null;
        return getSnapshot();
      })().finally(() => {
        loadPromise = null;
      });
    }

    return loadPromise;
  }

  async function updateSettings(patch = {}) {
    await load();

    const previousSnapshot = getSnapshot();
    const previousState = cloneValue(state);
    const nextState = mergeSettingsState(state, patch);
    const nextDocument = serializeSettingsDocument(nextState, safeStorage);

    await writePersistedDocument(fsImpl, settingsFilePath, backupFilePath, nextDocument, pathImpl);

    state = nextState;
    lastPersistedSnapshot = previousSnapshot;
    lastPersistedState = previousState;

    return {
      snapshot: getSnapshot(),
      previousSnapshot
    };
  }

  function getSnapshot() {
    assertLoaded(loaded);
    return cloneValue(toPublicSnapshot(state));
  }

  function getPreviousSnapshot() {
    return lastPersistedSnapshot ? cloneValue(lastPersistedSnapshot) : null;
  }

  async function rollbackLastUpdate() {
    await load();
    if (!lastPersistedState) {
      return getSnapshot();
    }

    const restoredState = cloneValue(lastPersistedState);
    const restoredDocument = serializeSettingsDocument(restoredState, safeStorage);
    await writePersistedDocument(fsImpl, settingsFilePath, backupFilePath, restoredDocument, pathImpl);
    state = restoredState;
    lastPersistedSnapshot = null;
    lastPersistedState = null;
    return getSnapshot();
  }

  function buildBackendEnv(baseEnv = process.env) {
    assertLoaded(loaded);

    const env = { ...baseEnv };
    const conversation = state.conversation;
    const speech = state.speech;

    env.MARGIN_LLM_PROVIDER = conversation.provider;
    if (conversation.model) {
      env.MARGIN_LLM_MODEL = conversation.model;
      const modelEnvNames = {
        openai: 'OPENAI_MODEL',
        anthropic: 'ANTHROPIC_MODEL',
        siliconflow: 'SILICONFLOW_MODEL'
      };
      if (modelEnvNames[conversation.provider]) {
        env[modelEnvNames[conversation.provider]] = conversation.model;
      }
    }
    env.MARGIN_LIGHT_READING_ENABLED = state.lightReadingEnabled ? 'true' : 'false';

    for (const provider of CONVERSATION_PROVIDERS) {
      if (provider === 'local') {
        continue;
      }

      const key = conversation.apiKeys[provider];
      if (key) {
        env[providerToApiKeyEnvName(provider)] = key;
      }
    }

    env.TTS_PROVIDER = speech.provider;
    env.SILICONFLOW_TTS_PROVIDER = speech.provider;
    setIfNonEmpty(env, 'SILICONFLOW_TTS_BASE_URL', speech.tts.baseUrl);
    setIfNonEmpty(env, 'SILICONFLOW_TTS_MODEL', speech.tts.model);
    setIfNonEmpty(env, 'SILICONFLOW_TTS_VOICE', speech.tts.voice);
    setIfNonEmpty(env, 'SILICONFLOW_TTS_RESPONSE_FORMAT', speech.tts.responseFormat);
    if (speech.tts.speed !== undefined && speech.tts.speed !== null) {
      env.SILICONFLOW_TTS_SPEED = String(speech.tts.speed);
    }

    env.STT_PROVIDER = speech.provider;
    env.SILICONFLOW_STT_PROVIDER = speech.provider;
    setIfNonEmpty(env, 'SILICONFLOW_STT_BASE_URL', speech.stt.baseUrl);
    setIfNonEmpty(env, 'SILICONFLOW_STT_MODEL', speech.stt.model);
    setIfNonEmpty(env, 'SILICONFLOW_STT_LANGUAGE', speech.stt.language);
    setIfNonEmpty(env, 'SILICONFLOW_STT_PROMPT', speech.stt.prompt);
    setIfNonEmpty(env, 'SILICONFLOW_STT_RESPONSE_FORMAT', speech.stt.responseFormat);
    if (speech.stt.temperature !== undefined && speech.stt.temperature !== null) {
      env.SILICONFLOW_STT_TEMPERATURE = String(speech.stt.temperature);
    }

    return env;
  }

  async function setConversationApiKey(provider, apiKey) {
    return updateSettings({
      conversation: {
        apiKeys: {
          [provider]: apiKey
        }
      }
    });
  }

  async function clearConversationApiKey(provider) {
    return setConversationApiKey(provider, null);
  }

  async function setConversationProvider(provider) {
    return updateSettings({
      conversation: {
        provider
      }
    });
  }

  async function setConversationModel(model) {
    return updateSettings({
      conversation: {
        model
      }
    });
  }

  async function setLightReadingEnabled(enabled) {
    return updateSettings({
      lightReadingEnabled: enabled
    });
  }

  async function setSpeechProvider(provider) {
    return updateSettings({
      speech: {
        provider
      }
    });
  }

  async function setTtsSettings(ttsPatch) {
    return updateSettings({
      speech: {
        tts: ttsPatch
      }
    });
  }

  async function setSttSettings(sttPatch) {
    return updateSettings({
      speech: {
        stt: sttPatch
      }
    });
  }

  return {
    load,
    updateSettings,
    getSnapshot,
    getPreviousSnapshot,
    rollbackLastUpdate,
    buildBackendEnv,
    setConversationApiKey,
    clearConversationApiKey,
    setConversationProvider,
    setConversationModel,
    setLightReadingEnabled,
    setSpeechProvider,
    setTtsSettings,
    setSttSettings,
    getSettingsFilePath: () => settingsFilePath,
    getBackupFilePath: () => backupFilePath
  };
}

function createEmptyApiKeyState() {
  return {
    openai: null,
    anthropic: null,
    siliconflow: null
  };
}

function resolveSettingsFilePath({ settingsFilePath, userDataPath, pathImpl = path } = {}) {
  if (settingsFilePath) {
    return pathImpl.resolve(settingsFilePath);
  }

  if (!userDataPath) {
    throw new Error('createSettingsStore requires settingsFilePath or userDataPath');
  }

  return pathImpl.join(pathImpl.resolve(userDataPath), SETTINGS_FILE_NAME);
}

async function readPersistedDocument(fsImpl, settingsFilePath, backupFilePath) {
  const primary = await tryReadJson(fsImpl, settingsFilePath, 'primary');
  if (primary) {
    return primary;
  }

  const backup = await tryReadJson(fsImpl, backupFilePath, 'backup');
  return backup;
}

async function tryReadJson(fsImpl, filePath, source) {
  try {
    const text = await fsImpl.readFile(filePath, 'utf8');
    if (!text.trim()) {
      return null;
    }

    return {
      document: JSON.parse(text),
      source
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }

    return null;
  }
}

async function restorePrimaryFromBackup(fsImpl, settingsFilePath, backupFilePath) {
  await fsImpl.copyFile(backupFilePath, settingsFilePath);
}

function deserializeSettingsDocument(document, safeStorage) {
  const defaults = createDefaultSettings();
  const source = isPlainObject(document) ? document : {};

  const conversationSource = isPlainObject(source.conversation) ? source.conversation : {};
  const speechSource = isPlainObject(source.speech) ? source.speech : {};
  const ttsSource = isPlainObject(speechSource.tts) ? speechSource.tts : {};
  const sttSource = isPlainObject(speechSource.stt) ? speechSource.stt : {};

  const apiKeys = createEmptyApiKeyState();
  const persistedApiKeys = isPlainObject(conversationSource.apiKeys) ? conversationSource.apiKeys : {};
  for (const provider of Object.keys(apiKeys)) {
    const entry = persistedApiKeys[provider];
    const ciphertext =
      typeof entry === 'string'
        ? entry
        : isPlainObject(entry) && typeof entry.ciphertext === 'string'
          ? entry.ciphertext
          : null;

    if (ciphertext) {
      apiKeys[provider] = decryptCiphertext(ciphertext, safeStorage);
    }
  }

  return {
    version: SETTINGS_VERSION,
    lightReadingEnabled: normalizeBoolean(source.lightReadingEnabled, defaults.lightReadingEnabled),
    appearance: {
      fontScale: normalizeBoundedNumber(source.appearance?.fontScale, defaults.appearance.fontScale, 0.92, 1.16),
      lineHeight: normalizeBoundedNumber(source.appearance?.lineHeight, defaults.appearance.lineHeight, 0.9, 1.2),
      motion: source.appearance?.motion === 'reduced' ? 'reduced' : 'full'
    },
    conversation: {
      provider: normalizeConversationProvider(conversationSource.provider, defaults.conversation.provider),
      model: normalizeText(conversationSource.model, defaults.conversation.model),
      apiKeys
    },
    speech: {
      provider: normalizeSpeechProvider(speechSource.provider, defaults.speech.provider),
      tts: {
        baseUrl: normalizeUrl(ttsSource.baseUrl, defaults.speech.tts.baseUrl),
        model: normalizeText(ttsSource.model, defaults.speech.tts.model),
        voice: normalizeText(ttsSource.voice, defaults.speech.tts.voice),
        responseFormat: normalizeText(ttsSource.responseFormat, defaults.speech.tts.responseFormat).toLowerCase() || defaults.speech.tts.responseFormat,
        speed: normalizePositiveNumber(ttsSource.speed, defaults.speech.tts.speed)
      },
      stt: {
        baseUrl: normalizeUrl(sttSource.baseUrl, defaults.speech.stt.baseUrl),
        model: normalizeText(sttSource.model, defaults.speech.stt.model),
        language: normalizeText(sttSource.language, defaults.speech.stt.language),
        prompt: normalizeText(sttSource.prompt, defaults.speech.stt.prompt),
        responseFormat: normalizeText(sttSource.responseFormat, defaults.speech.stt.responseFormat).toLowerCase() || defaults.speech.stt.responseFormat,
        temperature: normalizeNumber(sttSource.temperature, defaults.speech.stt.temperature)
      }
    }
  };
}

function serializeSettingsDocument(state, safeStorage) {
  const document = {
    version: SETTINGS_VERSION,
    lightReadingEnabled: Boolean(state.lightReadingEnabled),
    appearance: {
      fontScale: state.appearance.fontScale,
      lineHeight: state.appearance.lineHeight,
      motion: state.appearance.motion
    },
    conversation: {
      provider: state.conversation.provider,
      model: state.conversation.model,
      apiKeys: {}
    },
    speech: {
      provider: state.speech.provider,
      tts: {
        baseUrl: state.speech.tts.baseUrl,
        model: state.speech.tts.model,
        voice: state.speech.tts.voice,
        responseFormat: state.speech.tts.responseFormat,
        speed: state.speech.tts.speed
      },
      stt: {
        baseUrl: state.speech.stt.baseUrl,
        model: state.speech.stt.model,
        language: state.speech.stt.language,
        prompt: state.speech.stt.prompt,
        responseFormat: state.speech.stt.responseFormat,
        temperature: state.speech.stt.temperature
      }
    }
  };

  for (const provider of Object.keys(state.conversation.apiKeys)) {
    const apiKey = state.conversation.apiKeys[provider];
    if (!apiKey) {
      continue;
    }

    document.conversation.apiKeys[provider] = {
      ciphertext: encryptPlaintext(apiKey, safeStorage)
    };
  }

  return document;
}

async function writePersistedDocument(fsImpl, settingsFilePath, backupFilePath, document, pathImpl) {
  const directory = pathImpl.dirname(settingsFilePath);
  const tempFilePath = pathImpl.join(
    directory,
    `${pathImpl.basename(settingsFilePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const text = `${JSON.stringify(document, null, 2)}\n`;
  let hadExistingFile = false;

  await fsImpl.mkdir(directory, { recursive: true });

  try {
    await fsImpl.access(settingsFilePath);
    hadExistingFile = true;
  } catch {
    hadExistingFile = false;
  }

  try {
    if (hadExistingFile) {
      await fsImpl.copyFile(settingsFilePath, backupFilePath);
    }

    await fsImpl.writeFile(tempFilePath, text, 'utf8');

    if (hadExistingFile) {
      await fsImpl.rm(settingsFilePath, { force: true });
    }

    await fsImpl.rename(tempFilePath, settingsFilePath);
  } catch (error) {
    await restoreBackup(fsImpl, settingsFilePath, backupFilePath, hadExistingFile);
    throw error;
  } finally {
    await fsImpl.rm(tempFilePath, { force: true }).catch(() => {});
  }
}

async function restoreBackup(fsImpl, settingsFilePath, backupFilePath, hadExistingFile) {
  if (hadExistingFile) {
    try {
      await fsImpl.copyFile(backupFilePath, settingsFilePath);
    } catch {
      // Ignore rollback failures; the caller still receives the original error.
    }
  } else {
    await fsImpl.rm(settingsFilePath, { force: true }).catch(() => {});
  }
}

function mergeSettingsState(currentState, patch) {
  const nextState = cloneValue(currentState);

  if (patch.lightReadingEnabled !== undefined) {
    nextState.lightReadingEnabled = Boolean(patch.lightReadingEnabled);
  }

  if (patch.appearance !== undefined) {
    if (!isPlainObject(patch.appearance)) {
      throw new Error('appearance patch must be an object');
    }
    if (patch.appearance.fontScale !== undefined) {
      nextState.appearance.fontScale = normalizeBoundedNumber(patch.appearance.fontScale, nextState.appearance.fontScale, 0.92, 1.16);
    }
    if (patch.appearance.lineHeight !== undefined) {
      nextState.appearance.lineHeight = normalizeBoundedNumber(patch.appearance.lineHeight, nextState.appearance.lineHeight, 0.9, 1.2);
    }
    if (patch.appearance.motion !== undefined) {
      nextState.appearance.motion = patch.appearance.motion === 'reduced' ? 'reduced' : 'full';
    }
  }

  if (patch.conversation !== undefined) {
    if (!isPlainObject(patch.conversation)) {
      throw new Error('conversation patch must be an object');
    }

    if (patch.conversation.provider !== undefined) {
      nextState.conversation.provider = normalizeConversationProvider(
        patch.conversation.provider,
        nextState.conversation.provider,
        true
      );
    }

    if (patch.conversation.model !== undefined) {
      nextState.conversation.model = normalizeText(patch.conversation.model, nextState.conversation.model);
    }

    if (patch.conversation.apiKeys !== undefined) {
      if (!isPlainObject(patch.conversation.apiKeys)) {
        throw new Error('conversation.apiKeys patch must be an object');
      }

      for (const provider of Object.keys(patch.conversation.apiKeys)) {
        if (provider === 'local') {
          throw new Error('local conversation provider does not use an API key');
        }

        providerToApiKeyEnvName(provider);
        nextState.conversation.apiKeys[provider] = normalizeApiKey(patch.conversation.apiKeys[provider]);
      }
    }

    if (patch.conversation.apiKey !== undefined) {
      const provider = nextState.conversation.provider;
      if (provider === 'local') {
        throw new Error('local conversation provider does not use an API key');
      }

      providerToApiKeyEnvName(provider);
      nextState.conversation.apiKeys[provider] = normalizeApiKey(patch.conversation.apiKey);
    }
  }

  if (patch.speech !== undefined) {
    if (!isPlainObject(patch.speech)) {
      throw new Error('speech patch must be an object');
    }

    if (patch.speech.provider !== undefined) {
      nextState.speech.provider = normalizeSpeechProvider(
        patch.speech.provider,
        nextState.speech.provider,
        true
      );
    }

    if (patch.speech.tts !== undefined) {
      if (!isPlainObject(patch.speech.tts)) {
        throw new Error('speech.tts patch must be an object');
      }

      if (patch.speech.tts.baseUrl !== undefined) {
        nextState.speech.tts.baseUrl = normalizeUrl(patch.speech.tts.baseUrl, nextState.speech.tts.baseUrl);
      }
      if (patch.speech.tts.model !== undefined) {
        nextState.speech.tts.model = normalizeText(patch.speech.tts.model, nextState.speech.tts.model);
      }
      if (patch.speech.tts.voice !== undefined) {
        nextState.speech.tts.voice = normalizeText(patch.speech.tts.voice, nextState.speech.tts.voice);
      }
      if (patch.speech.tts.responseFormat !== undefined) {
        nextState.speech.tts.responseFormat =
          normalizeText(patch.speech.tts.responseFormat, nextState.speech.tts.responseFormat).toLowerCase() ||
          nextState.speech.tts.responseFormat;
      }
      if (patch.speech.tts.speed !== undefined) {
        nextState.speech.tts.speed = normalizePositiveNumber(patch.speech.tts.speed, nextState.speech.tts.speed);
      }
    }

    if (patch.speech.stt !== undefined) {
      if (!isPlainObject(patch.speech.stt)) {
        throw new Error('speech.stt patch must be an object');
      }

      if (patch.speech.stt.baseUrl !== undefined) {
        nextState.speech.stt.baseUrl = normalizeUrl(patch.speech.stt.baseUrl, nextState.speech.stt.baseUrl);
      }
      if (patch.speech.stt.model !== undefined) {
        nextState.speech.stt.model = normalizeText(patch.speech.stt.model, nextState.speech.stt.model);
      }
      if (patch.speech.stt.language !== undefined) {
        nextState.speech.stt.language = normalizeText(patch.speech.stt.language, nextState.speech.stt.language);
      }
      if (patch.speech.stt.prompt !== undefined) {
        nextState.speech.stt.prompt = normalizeText(patch.speech.stt.prompt, nextState.speech.stt.prompt);
      }
      if (patch.speech.stt.responseFormat !== undefined) {
        nextState.speech.stt.responseFormat =
          normalizeText(patch.speech.stt.responseFormat, nextState.speech.stt.responseFormat).toLowerCase() ||
          nextState.speech.stt.responseFormat;
      }
      if (patch.speech.stt.temperature !== undefined) {
        nextState.speech.stt.temperature = normalizeNumber(
          patch.speech.stt.temperature,
          nextState.speech.stt.temperature
        );
      }
    }
  }

  return nextState;
}

function toPublicSnapshot(state) {
  return {
    version: state.version,
    lightReadingEnabled: state.lightReadingEnabled,
    appearance: { ...state.appearance },
    conversation: {
      provider: state.conversation.provider,
      model: state.conversation.model,
      apiKeys: {
        openai: createMaskedKeySnapshot(state.conversation.apiKeys.openai),
        anthropic: createMaskedKeySnapshot(state.conversation.apiKeys.anthropic),
        siliconflow: createMaskedKeySnapshot(state.conversation.apiKeys.siliconflow)
      }
    },
    speech: {
      provider: state.speech.provider,
      tts: {
        baseUrl: state.speech.tts.baseUrl,
        model: state.speech.tts.model,
        voice: state.speech.tts.voice,
        responseFormat: state.speech.tts.responseFormat,
        speed: state.speech.tts.speed
      },
      stt: {
        baseUrl: state.speech.stt.baseUrl,
        model: state.speech.stt.model,
        language: state.speech.stt.language,
        prompt: state.speech.stt.prompt,
        responseFormat: state.speech.stt.responseFormat,
        temperature: state.speech.stt.temperature
      }
    }
  };
}

function createMaskedKeySnapshot(apiKey) {
  return {
    configured: Boolean(apiKey),
    masked: apiKey ? MASKED_SECRET : null
  };
}

function normalizeConversationProvider(value, fallback, strict = false) {
  return normalizeEnumeratedValue(value, CONVERSATION_PROVIDERS, fallback, strict, 'conversation.provider');
}

function normalizeSpeechProvider(value, fallback, strict = false) {
  return normalizeEnumeratedValue(value, SPEECH_PROVIDERS, fallback, strict, 'speech.provider');
}

function normalizeEnumeratedValue(value, allowedValues, fallback, strict, label) {
  const normalized = normalizeText(value, '').toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (allowedValues.includes(normalized)) {
    return normalized;
  }

  if (strict) {
    throw new Error(`Unsupported ${label}: ${value}`);
  }

  return fallback;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function normalizeText(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return String(value).trim();
}

function normalizeUrl(value, fallback) {
  const normalized = normalizeText(value, '');
  return normalized || fallback;
}

function normalizeNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = normalizeNumber(value, fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoundedNumber(value, fallback, minimum, maximum) {
  const normalized = normalizePositiveNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, normalized));
}

function normalizeApiKey(value) {
  const normalized = normalizeText(value, '');
  return normalized || null;
}

function encryptPlaintext(value, safeStorage) {
  if (!safeStorage || typeof safeStorage.encryptString !== 'function') {
    throw new Error('safeStorage.encryptString is required to persist API keys');
  }

  const encrypted = safeStorage.encryptString(value);
  return Buffer.from(encrypted).toString('base64');
}

function decryptCiphertext(ciphertext, safeStorage) {
  if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
    throw new Error('safeStorage.decryptString is required to load API keys');
  }

  const decrypted = safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  return normalizeApiKey(decrypted);
}

function providerToApiKeyEnvName(provider) {
  switch (provider) {
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'siliconflow':
      return 'SILICONFLOW_API_KEY';
    default:
      throw new Error(`Unsupported conversation provider: ${provider}`);
  }
}

function setIfNonEmpty(target, key, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    target[key] = String(value);
  }
}

function assertLoaded(loaded) {
  if (!loaded) {
    throw new Error('Settings store has not been loaded yet. Call load() first.');
  }
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
