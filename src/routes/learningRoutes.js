import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import {
  addLearningEvent,
  getLearningEvents,
  getLearningSessions,
  updateLearningStep
} from '../storage/memoryStore.js';
import { buildManualStepEvent } from '../services/learningEvents.js';
import { buildLearningViewModel, emptyLearningViewModel } from '../services/learningViewModel.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sessions = await getLearningSessions({
      status,
      limit: Number.isFinite(limit) ? limit : undefined
    });

    sendData(res, { sessions });
  } catch (error) {
    next(error);
  }
});

router.get('/active', async (_req, res, next) => {
  try {
    const sessions = await getLearningSessions({ status: 'active', limit: 10 });
    const currentSession = sessions[0] || null;
    sendData(res, {
      sessions,
      current_session: currentSession,
      current_learning: currentSession
        ? buildLearningViewModel(currentSession)
        : emptyLearningViewModel()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const sessionId = Number.parseInt(req.query.sessionId, 10);
    const events = await getLearningEvents({
      sessionId: Number.isFinite(sessionId) ? sessionId : undefined,
      limit: Number.isFinite(limit) ? limit : undefined
    });

    sendData(res, { events });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/steps/:stepIndex', async (req, res, next) => {
  try {
    const sessionId = Number.parseInt(req.params.id, 10);
    const stepIndex = Number.parseInt(req.params.stepIndex, 10);
    const status = typeof req.body?.status === 'string' ? req.body.status : 'done';

    if (!Number.isFinite(sessionId) || !Number.isFinite(stepIndex)) {
      return sendError(res, 400, 'valid session id and step index are required', 'invalid_learning_identifiers');
    }

    if (!['pending', 'active', 'done'].includes(status)) {
      return sendError(res, 400, 'status must be pending, active, or done', 'invalid_learning_status');
    }

    const session = await updateLearningStep(sessionId, stepIndex, status);

    if (!session) {
      return sendError(res, 404, 'learning session not found', 'learning_session_not_found');
    }

    await addLearningEvent(buildManualStepEvent({
      session,
      stepIndex,
      status
    }));

    return sendData(res, { session });
  } catch (error) {
    return next(error);
  }
});

export default router;
