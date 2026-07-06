import { Router } from 'express';
import { getEchoState } from '../services/echoStateEngine.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const state = await getEchoState(query);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

export default router;
