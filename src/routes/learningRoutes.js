import { Router } from 'express';
import {
  addLearningEvent,
  getLearningEvents,
  getLearningSessions,
  updateLearningStep
} from '../storage/memoryStore.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sessions = await getLearningSessions({
      status,
      limit: Number.isFinite(limit) ? limit : undefined
    });

    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

router.get('/active', async (_req, res, next) => {
  try {
    const sessions = await getLearningSessions({ status: 'active', limit: 10 });
    res.json({ sessions });
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

    res.json({ events });
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
      return res.status(400).json({ error: 'valid session id and step index are required' });
    }

    if (!['pending', 'active', 'done'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, active, or done' });
    }

    const session = await updateLearningStep(sessionId, stepIndex, status);

    if (!session) {
      return res.status(404).json({ error: 'learning session not found' });
    }

    await addLearningEvent({
      sessionId: session.id,
      topic: session.topic,
      eventType: `manual_step_${status}`,
      stepIndex,
      stepTitle: session.steps[stepIndex]?.title,
      note: 'Step status was changed through the learning API.'
    });

    return res.json({ session });
  } catch (error) {
    return next(error);
  }
});

export default router;
