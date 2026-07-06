import { Router } from 'express';
import { handleChat } from '../services/chatService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await handleChat(message);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
