import { Router } from 'express';
import { sendData } from '../lib/apiResponse.js';
import { getAchievementIconCatalog } from '../services/achievementIconCatalog.js';
import {
  buildAchievementViewModel,
  buildRecentAchievementViewModel
} from '../services/achievementViewModel.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const achievements = await buildAchievementViewModel();
    return sendData(res, achievements);
  } catch (error) {
    return next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const recent = await buildRecentAchievementViewModel({ limit: req.query.limit });
    return sendData(res, recent);
  } catch (error) {
    return next(error);
  }
});

router.get('/icons', (_req, res) => {
  return sendData(res, { icons: getAchievementIconCatalog() });
});

export default router;
