import { Router } from 'express';
import { sendData } from '../lib/apiResponse.js';
import { generateDailySummary } from '../services/reflectionEngine.js';
import { buildReflectionViewModel } from '../services/reflectionViewModel.js';
import { getSummaries } from '../storage/memoryStore.js';

const router = Router();

router.post('/', async (_req, res, next) => {
  try {
    const summary = await generateDailySummary();
    sendData(res, summary);
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

    sendData(res, {
      summaries,
      current_reflection: buildReflectionViewModel(summaries)
    });
  } catch (error) {
    next(error);
  }
});

export default router;
