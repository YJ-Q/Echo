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
import { ensureMemoryStore } from './storage/memoryStore.js';

export async function createApp() {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.join(__dirname, '..', 'public');

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(publicDir));

  await ensureMemoryStore();

  app.get('/api', (_req, res) => {
    sendData(res, {
      name: 'Echo',
      status: 'ui-connected',
      message: 'Echo API is running with the local desktop-style frontend.',
      endpoints: ['/health', '/state', '/actions', '/chat', '/memory', '/summary', '/learning', '/tts']
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

  app.use((err, _req, res, _next) => {
    console.error(err);
    sendError(
      res,
      err.status || 500,
      err.message || 'Echo became quiet for a moment.',
      err.code || 'internal_error'
    );
  });

  return app;
}
