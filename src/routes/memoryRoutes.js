import { Router } from 'express';
import { sendData } from '../lib/apiResponse.js';
import { getMemories, getUserProfile, getUserStates } from '../storage/memoryStore.js';
import { buildContext } from '../services/contextBuilder.js';
import { summarizeProfile } from '../services/profileEngine.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const memories = await getMemories({
      limit: Number.isFinite(limit) ? limit : undefined
    });

    sendData(res, { memories });
  } catch (error) {
    next(error);
  }
});

router.get('/states', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const states = await getUserStates({
      limit: Number.isFinite(limit) ? limit : undefined
    });

    sendData(res, { states });
  } catch (error) {
    next(error);
  }
});

router.get('/profile', async (_req, res, next) => {
  try {
    const profile = await getUserProfile();
    sendData(res, {
      profile,
      summary: summarizeProfile(profile)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/context', async (req, res, next) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const context = await buildContext(query);
    sendData(res, { context });
  } catch (error) {
    next(error);
  }
});

export default router;
