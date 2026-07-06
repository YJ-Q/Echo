import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { handleChat } from '../services/chatService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      return sendError(res, 400, 'message is required', 'message_required');
    }

    const result = await handleChat(message);
    return sendData(res, result);
  } catch (error) {
    return next(error);
  }
});

export default router;
