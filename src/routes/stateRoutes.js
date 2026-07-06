import { Router } from 'express';
import { sendData } from '../lib/apiResponse.js';
import { getEchoState } from '../services/echoStateEngine.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const state = await getEchoState(query);
    sendData(res, state);
  } catch (error) {
    next(error);
  }
});

export default router;
