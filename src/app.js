import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import actionRoutes from './routes/actionRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import learningRoutes from './routes/learningRoutes.js';
import memoryRoutes from './routes/memoryRoutes.js';
import stateRoutes from './routes/stateRoutes.js';
import summaryRoutes from './routes/summaryRoutes.js';
import ttsRoutes from './routes/ttsRoutes.js';
import { sendData, sendError } from './lib/apiResponse.js';
import { createRequestLogger } from './lib/logger.js';
import { ensureMemoryStore } from './storage/memoryStore.js';

export async function createApp({ logger } = {}) {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.join(__dirname, '..', 'public');

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  if (logger) {
    app.use(createRequestLogger(logger));
  }
  app.use(express.static(publicDir));

  await ensureMemoryStore();

  app.get('/api', (_req, res) => {
    const ttsAvailable = Boolean(process.env.SILICONFLOW_API_KEY);
    sendData(res, {
      name: 'Echo',
      status: 'ui-connected',
      message: 'Echo API is running with the local desktop-style frontend.',
      endpoints: ['/health', '/state', '/actions', '/chat', '/memory', '/summary', '/learning', '/tts'],
      capabilities: { tts: ttsAvailable }
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
    if (logger) {
      logger.error(err.message || 'Unhandled Echo error', {
        request_id: req.requestId,
        code: err.code || 'internal_error',
        status: err.status || 500
      });
    } else {
      console.error(err);
    }
    sendError(
      res,
      err.status || 500,
      err.message || 'Echo became quiet for a moment.',
      err.code || 'internal_error'
    );
  });

  return app;
}
