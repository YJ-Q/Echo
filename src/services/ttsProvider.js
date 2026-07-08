import { TtsProviderError } from './ttsErrors.js';

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1/audio/speech';
const DEFAULT_PROVIDER = 'siliconflow';

const DEFAULTS = {
  model: 'FunAudioLLM/CosyVoice2-0.5B',
  voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
  response_format: 'mp3',
  speed: 1.0
};

function normalizeProviderName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseSpeed(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULTS.speed;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULTS.speed;
  }

  return parsed;
}

export function buildTtsConfig(env = process.env) {
  const provider =
    normalizeProviderName(env.TTS_PROVIDER) ||
    normalizeProviderName(env.SILICONFLOW_TTS_PROVIDER) ||
    DEFAULT_PROVIDER;

  const apiKey = env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (provider !== DEFAULT_PROVIDER) {
    return null;
  }

  return {
    name: DEFAULT_PROVIDER,
    apiKey,
    base_url: env.SILICONFLOW_TTS_BASE_URL || DEFAULT_BASE_URL,
    model: env.SILICONFLOW_TTS_MODEL || DEFAULTS.model,
    voice: env.SILICONFLOW_TTS_VOICE || DEFAULTS.voice,
    response_format: env.SILICONFLOW_TTS_RESPONSE_FORMAT || DEFAULTS.response_format,
    speed: parseSpeed(env.SILICONFLOW_TTS_SPEED)
  };
}

export function createTtsProvider({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = buildTtsConfig(env);

  if (!config) {
    const provider =
      normalizeProviderName(env.TTS_PROVIDER) ||
      normalizeProviderName(env.SILICONFLOW_TTS_PROVIDER) ||
      DEFAULT_PROVIDER;
    const reason = env.SILICONFLOW_API_KEY
      ? `unsupported TTS provider "${provider}"`
      : 'SILICONFLOW_API_KEY not set';
    console.warn(`${reason}; TTS unavailable.`);
    return null;
  }

  return {
    name: config.name,
    model: config.model,
    voice: config.voice,
    response_format: config.response_format,
    base_url: config.base_url,
    speed: config.speed,
    async synthesize(text) {
      let response;

      try {
        response = await fetchImpl(config.base_url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            input: text,
            voice: config.voice,
            response_format: config.response_format,
            speed: config.speed
          })
        });
      } catch (error) {
        throw new TtsProviderError(
          'tts_provider_request_failed',
          `TTS request failed before a response was received: ${error.message}`,
          { cause: error }
        );
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new TtsProviderError(
          'tts_provider_http_error',
          `TTS request failed with status ${response.status}: ${detail}`
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const detail = await response.text();
        throw new TtsProviderError(
          'tts_provider_json_response',
          `TTS request returned JSON instead of audio: ${detail}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new TtsProviderError(
          'tts_empty_audio',
          'TTS request returned an empty audio payload'
        );
      }

      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return {
        mimeType: mimeTypeForFormat(config.response_format),
        data: base64
      };
    }
  };
}

function mimeTypeForFormat(format) {
  const normalized = String(format || '').trim().toLowerCase();
  const mimeTypes = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    opus: 'audio/opus',
    flac: 'audio/flac'
  };

  return mimeTypes[normalized] || 'audio/mpeg';
}

let instance = null;

export function getTtsProvider() {
  if (!instance) {
    instance = createTtsProvider();
  }

  return instance;
}

export function resetTtsProvider() {
  instance = null;
}
