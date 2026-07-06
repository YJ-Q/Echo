import express from 'express';
import cors from 'cors';
import actionRoutes from './routes/actionRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import learningRoutes from './routes/learningRoutes.js';
import memoryRoutes from './routes/memoryRoutes.js';
import stateRoutes from './routes/stateRoutes.js';
import summaryRoutes from './routes/summaryRoutes.js';
import ttsRoutes from './routes/ttsRoutes.js';
import { sendData, sendError } from './lib/apiResponse.js';
import { logger } from './lib/logger.js';
import { ensureMemoryStore } from './storage/memoryStore.js';

export async function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, 'request');
    next();
  });

  await ensureMemoryStore();

  app.get('/', (_req, res) => {
    sendData(res, {
      name: 'Echo',
      status: 'backend-only',
      message: 'Echo API is running. Frontend is intentionally paused while backend systems are refined.',
      endpoints: ['/health', '/state', '/actions', '/chat', '/memory', '/summary', '/learning']
    });
  });

  app.get('/health', (_req, res) => {
    sendData(res, { status: 'ok', name: 'Echo' });
  });

  app.use('/chat', chatRoutes);
  app.use('/state', stateRoutes);
  app.use('/actions', actionRoutes);
  app.use('/learning', learningRoutes);
  app.use('/memory', memoryRoutes);
  app.use('/summary', summaryRoutes);
  app.use('/tts', ttsRoutes);

  app.use((err, req, res, _next) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    sendError(
      res,
      err.status || 500,
      err.message || 'Echo became quiet for a moment.',
      err.code || 'internal_error'
    );
  });

  return app;
}
