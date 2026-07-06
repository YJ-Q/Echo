import { Router } from 'express';
import { generateDailySummary } from '../services/reflectionEngine.js';
import { getSummaries } from '../storage/memoryStore.js';

const router = Router();

router.post('/', async (_req, res, next) => {
  try {
    const summary = await generateDailySummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const summaries = await getSummaries({
      limit: Number.isFinite(limit) ? limit : 7
    });

    res.json({ summaries });
  } catch (error) {
    next(error);
  }
});

export default router;
