import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import { getMemories, getUserProfile, getUserStates } from '../storage/memoryStore.js';
import { buildContext } from '../services/contextBuilder.js';
import { buildMemoryViewModel } from '../services/memoryViewModel.js';
import {
  calibrateMemoryPriority,
  getCalibrationSnapshot,
  overrideProfileSignal,
  pinMemory
} from '../services/memoryCalibrationEngine.js';
import { summarizeProfile } from '../services/profileEngine.js';
import { synthesizeProfileFromMemories } from '../services/profileSynthesisEngine.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const memories = await getMemories({
      limit: Number.isFinite(limit) ? limit : 40
    });

    sendData(res, {
      memories,
      current_memory: buildMemoryViewModel(memories)
    });
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

router.post('/profile/refresh', async (_req, res, next) => {
  try {
    const synthesis = await synthesizeProfileFromMemories();
    const profile = await getUserProfile();

    sendData(res, {
      synthesis,
      profile,
      summary: summarizeProfile(profile)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/profile/override', async (req, res, next) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
    const confidence = Number(req.body?.confidence);

    if (!key || !value) {
      return sendError(res, 400, 'key and value are required', 'profile_override_required');
    }

    const result = await overrideProfileSignal({
      key,
      value,
      confidence: Number.isFinite(confidence) ? confidence : 0.92
    });

    return sendData(res, result);
  } catch (error) {
    return next(error);
  }
});

router.get('/calibration', async (_req, res, next) => {
  try {
    const snapshot = await getCalibrationSnapshot();
    sendData(res, snapshot);
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

router.post('/:id/pin', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isFinite(id)) {
      return sendError(res, 400, 'valid memory id is required', 'invalid_memory_id');
    }

    const memory = await pinMemory(id);

    if (!memory) {
      return sendError(res, 404, 'memory not found', 'memory_not_found');
    }

    return sendData(res, { memory });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/priority', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isFinite(id)) {
      return sendError(res, 400, 'valid memory id is required', 'invalid_memory_id');
    }

    const memory = await calibrateMemoryPriority(id, req.body || {});

    if (!memory) {
      return sendError(res, 404, 'memory not found', 'memory_not_found');
    }

    return sendData(res, { memory });
  } catch (error) {
    return next(error);
  }
});

export default router;
