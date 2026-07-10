import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { getSttProvider, isSttProviderError } from '../services/sttProvider.js';

const router = Router();
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

router.post('/', async (req, res, next) => {
  try {
    const encodedAudio = typeof req.body?.audio_base64 === 'string' ? req.body.audio_base64.trim() : '';
    if (!encodedAudio) {
      return sendError(res, 400, 'audio_base64 is required', 'audio_required');
    }
    if (!isBase64(encodedAudio)) {
      return sendError(res, 400, 'audio_base64 must be valid base64', 'invalid_audio_encoding');
    }

    const estimatedBytes = Math.floor((encodedAudio.length * 3) / 4);
    if (estimatedBytes > MAX_AUDIO_BYTES) {
      return sendError(res, 413, 'audio exceeds the 8 MB transcription limit', 'audio_too_large');
    }

    const audio = Buffer.from(encodedAudio, 'base64');
    if (audio.byteLength === 0) {
      return sendError(res, 400, 'audio payload is empty', 'empty_audio');
    }

    const provider = getSttProvider();
    if (!provider) {
      return sendError(res, 502, 'STT provider is not supported', 'stt_not_configured');
    }

    const transcript = await provider.transcribe(audio, {
      filename: sanitizeFilename(req.body?.filename),
      mimeType: sanitizeMimeType(req.body?.mime_type)
    });

    return sendData(res, {
      transcript,
      provider: provider.name,
      model: provider.model
    });
  } catch (error) {
    if (isSttProviderError(error)) {
      return sendError(res, error.status, error.message, error.code);
    }
    return next(error);
  }
});

function isBase64(value) {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function sanitizeFilename(value) {
  const filename = typeof value === 'string' ? value.trim() : '';
  return filename && filename.length <= 160 ? filename : 'margin-recording.webm';
}

function sanitizeMimeType(value) {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^audio\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : 'audio/webm';
}

export default router;
