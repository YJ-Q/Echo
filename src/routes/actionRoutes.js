import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
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

    sendData(res, { actions });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const action = await createManualAction(req.body || {});
    sendData(res, { action }, 201);
  } catch (error) {
    next(error);
  }
});

router.post('/suggested', async (req, res, next) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const action = await createSuggestedAction(query);
    sendData(res, { action }, 201);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const status = typeof req.body?.status === 'string' ? req.body.status : '';

    if (!Number.isFinite(id)) {
      return sendError(res, 400, 'valid action id is required', 'invalid_action_id');
    }

    if (!['pending', 'active', 'done', 'dismissed'].includes(status)) {
      return sendError(res, 400, 'status must be pending, active, done, or dismissed', 'invalid_action_status');
    }

    const action = await setActionStatus(id, status);

    if (!action) {
      return sendError(res, 404, 'action not found', 'action_not_found');
    }

    return sendData(res, { action });
  } catch (error) {
    return next(error);
  }
});

export default router;
