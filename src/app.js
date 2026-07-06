import express from 'express';
import cors from 'cors';
import actionRoutes from './routes/actionRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import learningRoutes from './routes/learningRoutes.js';
import memoryRoutes from './routes/memoryRoutes.js';
import stateRoutes from './routes/stateRoutes.js';
import summaryRoutes from './routes/summaryRoutes.js';
import { ensureMemoryStore } from './storage/memoryStore.js';

export async function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  await ensureMemoryStore();

  app.get('/', (_req, res) => {
    res.json({
      name: 'Echo',
      status: 'backend-only',
      message: 'Echo API is running. Frontend is intentionally paused while backend systems are refined.',
      endpoints: ['/health', '/state', '/actions', '/chat', '/memory', '/summary', '/learning']
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', name: 'Echo' });
  });

  app.use('/chat', chatRoutes);
  app.use('/state', stateRoutes);
  app.use('/actions', actionRoutes);
  app.use('/learning', learningRoutes);
  app.use('/memory', memoryRoutes);
  app.use('/summary', summaryRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || 'Echo became quiet for a moment.'
    });
  });

  return app;
}
