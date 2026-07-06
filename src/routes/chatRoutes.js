import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { handleChat } from '../services/chatService.js';
import { getTtsProvider } from '../services/ttsProvider.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const withTts = req.body?.tts === true;

    if (!message) {
      return sendError(res, 400, 'message is required', 'message_required');
    }

    const result = await handleChat(message);

    if (withTts) {
      const tts = getTtsProvider();

      if (tts) {
        try {
          const audio = await tts.synthesize(result.reply);
          result.audio = audio;
        } catch (error) {
          result.audio = null;
        }
      } else {
        result.audio = null;
      }
    }

    return sendData(res, result);
  } catch (error) {
    return next(error);
  }
});

export default router;
