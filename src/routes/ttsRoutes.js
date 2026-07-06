import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { getTtsProvider } from '../services/ttsProvider.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!text) {
      return sendError(res, 400, 'text is required', 'text_required');
    }

    const provider = getTtsProvider();

    if (!provider) {
      return sendError(
        res,
        502,
        'TTS unavailable — SILICONFLOW_API_KEY not configured',
        'tts_not_configured'
      );
    }

    const audio = await provider.synthesize(text);

    return sendData(res, {
      text,
      audio: {
        mime_type: audio.mimeType,
        data: audio.data,
        size_bytes: Math.round((audio.data.length * 3) / 4)
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
