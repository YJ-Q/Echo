import { promises as fs } from 'node:fs';
import path from 'node:path';

export const STT_DEFAULTS = Object.freeze({
  provider: 'siliconflow',
  base_url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
  model: 'FunAudioLLM/SenseVoiceSmall',
  language: ''
});

export class SttProviderError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SttProviderError';
    this.code = code;
    this.status = status;
  }
}

export function isSttProviderError(error) {
  return error instanceof SttProviderError;
}

function normalizeProviderName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeTextValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLanguage(value) {
  const normalized = normalizeTextValue(value);
  return normalized || STT_DEFAULTS.language;
}

function normalizeMimeType(value) {
  const normalized = normalizeTextValue(value).toLowerCase();
  return normalized || '';
}

function inferMimeTypeFromFilename(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();

  const mimeTypes = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm'
  };

  return mimeTypes[extension] || 'application/octet-stream';
}

function inferFilenameFromMimeType(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  const filenames = {
    'audio/aac': 'audio.aac',
    'audio/flac': 'audio.flac',
    'audio/mp4': 'audio.m4a',
    'audio/mpeg': 'audio.mp3',
    'audio/ogg': 'audio.ogg',
    'audio/opus': 'audio.opus',
    'audio/wav': 'audio.wav',
    'audio/webm': 'audio.webm'
  };

  return filenames[normalized] || 'audio.wav';
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return null;
}

async function readAudioBuffer(input, fsImpl) {
  try {
    return await fsImpl.readFile(input);
  } catch (error) {
    throw new SttProviderError(
      'stt_audio_read_failed',
      'STT audio file could not be read',
      { status: 400, cause: error }
    );
  }
}

async function normalizeAudioInput(input, { filename, mimeType } = {}, fsImpl = fs) {
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    if ('buffer' in input || 'path' in input || 'filename' in input || 'mimeType' in input) {
      const nestedInput = 'buffer' in input ? input.buffer : input.path;
      const nestedFilename = filename ?? input.filename;
      const nestedMimeType = mimeType ?? input.mimeType;
      return normalizeAudioInput(nestedInput, { filename: nestedFilename, mimeType: nestedMimeType }, fsImpl);
    }
  }

  const rawBuffer = toBuffer(input);
  if (rawBuffer) {
    const resolvedFilename = path.basename(normalizeTextValue(filename) || inferFilenameFromMimeType(mimeType));
    const resolvedMimeType = normalizeMimeType(mimeType) || inferMimeTypeFromFilename(resolvedFilename);
    return {
      buffer: rawBuffer,
      filename: resolvedFilename,
      mimeType: resolvedMimeType
    };
  }

  if (typeof input === 'string') {
    const buffer = await readAudioBuffer(input, fsImpl);
    const resolvedFilename = path.basename(normalizeTextValue(filename) || input || inferFilenameFromMimeType(mimeType));
    const resolvedMimeType = normalizeMimeType(mimeType) || inferMimeTypeFromFilename(resolvedFilename);
    return {
      buffer,
      filename: resolvedFilename,
      mimeType: resolvedMimeType
    };
  }

  throw new SttProviderError(
    'stt_invalid_audio_input',
    'STT input must be a Buffer, file path, or an object with buffer/path metadata',
    { status: 400 }
  );
}

function normalizeTranscriptText(payload) {
  if (typeof payload === 'string') {
    return payload.replace(/\r\n/g, '\n').trim();
  }

  if (payload && typeof payload === 'object' && typeof payload.text === 'string') {
    return payload.text.replace(/\r\n/g, '\n').trim();
  }

  return '';
}

function isAbortLikeError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function classifyFetchFailure(error) {
  if (isAbortLikeError(error)) {
    return new SttProviderError(
      'stt_request_aborted',
      'STT request was aborted or timed out',
      { status: 504, cause: error }
    );
  }

  return new SttProviderError(
    'stt_request_failed',
    'STT request failed before a response was received',
    { status: 502, cause: error }
  );
}

function buildConfigFromEnv(env = process.env) {
  const provider =
    normalizeProviderName(env.STT_PROVIDER) ||
    normalizeProviderName(env.SILICONFLOW_STT_PROVIDER) ||
    STT_DEFAULTS.provider;

  if (provider !== STT_DEFAULTS.provider) {
    return null;
  }

  return {
    name: STT_DEFAULTS.provider,
    apiKey: normalizeTextValue(env.SILICONFLOW_API_KEY),
    base_url: normalizeTextValue(env.STT_BASE_URL) ||
      normalizeTextValue(env.SILICONFLOW_STT_BASE_URL) ||
      STT_DEFAULTS.base_url,
    model: normalizeTextValue(env.STT_MODEL) ||
      normalizeTextValue(env.SILICONFLOW_STT_MODEL) ||
      STT_DEFAULTS.model,
    language: normalizeLanguage(
      env.STT_LANGUAGE ?? env.SILICONFLOW_STT_LANGUAGE
    )
  };
}

export function buildSttConfig(env = process.env) {
  return buildConfigFromEnv(env);
}

export function createSttProvider({ env = process.env, fetchImpl = global.fetch, fsImpl = fs } = {}) {
  const config = buildSttConfig(env);

  if (!config) {
    return null;
  }

  return {
    name: config.name,
    base_url: config.base_url,
    model: config.model,
    language: config.language,
    async transcribe(input, options = {}) {
      if (!config.apiKey) {
        throw new SttProviderError(
          'stt_missing_api_key',
          'SILICONFLOW_API_KEY is not configured for STT',
          { status: 503 }
        );
      }

      const audio = await normalizeAudioInput(input, options, fsImpl);

      if (audio.buffer.byteLength === 0) {
        throw new SttProviderError(
          'stt_empty_audio',
          'STT input audio was empty',
          { status: 400 }
        );
      }

      const formData = new FormData();
      formData.append('file', new Blob([audio.buffer], { type: audio.mimeType }), audio.filename);
      formData.append('model', config.model);

      if (config.language) {
        formData.append('language', config.language);
      }

      let response;

      try {
        response = await fetchImpl(config.base_url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`
          },
          body: formData,
          signal: options.signal
        });
      } catch (error) {
        throw classifyFetchFailure(error);
      }

      if (!response.ok) {
        throw new SttProviderError(
          'stt_http_error',
          `STT request failed with HTTP status ${response.status}`,
          { status: 502 }
        );
      }

      let payload;

      try {
        const raw = await response.text();
        payload = JSON.parse(raw);
      } catch (error) {
        throw new SttProviderError(
          'stt_invalid_json',
          'STT response was not valid JSON',
          { status: 502, cause: error }
        );
      }

      const transcript = normalizeTranscriptText(payload);
      if (!transcript) {
        throw new SttProviderError(
          'stt_empty_text',
          'STT response did not contain transcript text',
          { status: 502 }
        );
      }

      return transcript;
    }
  };
}

let instance = null;

export function getSttProvider() {
  if (!instance) {
    instance = createSttProvider();
  }

  return instance;
}

export function resetSttProvider() {
  instance = null;
}
