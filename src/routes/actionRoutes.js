import { Router } from 'express';
import {
  createManualAction,
  createSuggestedAction,
  listActions,
  setActionStatus
} from '../services/actionEngine.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Number.parseInt(req.query.limit, 10);
    const actions = await listActions({
      status,
      limit: Number.isFinite(limit) ? limit : undefined
    });

    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const action = await createManualAction(req.body || {});
    res.status(201).json({ action });
  } catch (error) {
    next(error);
  }
});

router.post('/suggested', async (req, res, next) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const action = await createSuggestedAction(query);
    res.status(201).json({ action });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const status = typeof req.body?.status === 'string' ? req.body.status : '';

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'valid action id is required' });
    }

    if (!['pending', 'active', 'done', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, active, done, or dismissed' });
    }

    const action = await setActionStatus(id, status);

    if (!action) {
      return res.status(404).json({ error: 'action not found' });
    }

    return res.json({ action });
  } catch (error) {
    return next(error);
  }
});

export default router;
