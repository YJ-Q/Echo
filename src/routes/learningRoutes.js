import { Router } from 'express';
import { sendData, sendError } from '../lib/apiResponse.js';
import {
  addLearningEvent,
  getLatestPendingGrowthSuggestion,
  getLearningEvents,
  getLearningSessionById,
  getLearningSessions,
  updateLearningStep
} from '../storage/memoryStore.js';
import { buildManualStepEvent } from '../services/learningEvents.js';
import { confirmGrowthSuggestion, dismissGrowthSuggestion } from '../services/learningEngine.js';
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
    const [sessions, pendingSuggestion] = await Promise.all([
      getLearningSessions({ status: 'active', limit: 10 }),
      getLatestPendingGrowthSuggestion()
    ]);
    const currentSession = sessions[0] || null;
    sendData(res, {
      sessions,
      current_session: currentSession,
      current_learning: currentSession
        ? buildLearningViewModel(currentSession)
        : emptyLearningViewModel(),
      pending_suggestion: pendingSuggestion
    });
  } catch (error) {
    next(error);
  }
});

router.post('/suggestions/:key/confirm', async (req, res, next) => {
  try {
    const result = await confirmGrowthSuggestion(req.params.key);
    if (!result) {
      return sendError(res, 404, 'growth suggestion not found', 'growth_suggestion_not_found');
    }
    return sendData(res, result);
  } catch (error) {
    return next(error);
  }
});

router.post('/suggestions/:key/dismiss', async (req, res, next) => {
  try {
    const suggestion = await dismissGrowthSuggestion(req.params.key);
    if (!suggestion) {
      return sendError(res, 404, 'growth suggestion not found', 'growth_suggestion_not_found');
    }
    return sendData(res, { suggestion });
  } catch (error) {
    return next(error);
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
    const rawResult = typeof req.body?.result === 'string' ? req.body.result : '';
    const result = rawResult.trim();

    if (!Number.isFinite(sessionId) || !Number.isFinite(stepIndex)) {
      return sendError(res, 400, 'valid session id and step index are required', 'invalid_learning_identifiers');
    }

    if (!['pending', 'active', 'done'].includes(status)) {
      return sendError(res, 400, 'status must be pending, active, or done', 'invalid_learning_status');
    }

    if (rawResult.length > 4000) {
      return sendError(res, 400, 'learning result must be 4000 characters or fewer', 'learning_result_too_long');
    }

    const existingSession = await getLearningSessionById(sessionId);

    if (!existingSession) {
      return sendError(res, 404, 'learning session not found', 'learning_session_not_found');
    }

    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= existingSession.steps.length) {
      const error = new Error('learning step index is out of range');
      error.status = 400;
      error.code = 'learning_step_out_of_range';
      throw error;
    }

    if (existingSession.steps[stepIndex]?.status === status) {
      return sendData(res, { session: existingSession, already_applied: true });
    }

    const session = await updateLearningStep(sessionId, stepIndex, status);

    await addLearningEvent(buildManualStepEvent({
      session,
      stepIndex,
      status,
      userInput: result
    }));

    return sendData(res, { session, already_applied: false });
  } catch (error) {
    return next(error);
  }
});

export default router;
