import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { getAchievementIconCatalog } from '../services/achievementIconCatalog.js';
import {
  acknowledgeAchievement,
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

router.post('/:key/acknowledge', async (req, res, next) => {
  try {
    const key = typeof req.params.key === 'string' ? req.params.key.trim() : '';

    if (!key) {
      return sendError(res, 404, 'Achievement not found', 'achievement_not_found');
    }

    const achievement = await acknowledgeAchievement(key);

    if (!achievement) {
      return sendError(res, 404, 'Achievement not found', 'achievement_not_found');
    }

    return sendData(res, { achievement });
  } catch (error) {
    return next(error);
  }
});

export default router;
