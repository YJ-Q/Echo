import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import achievementRoutes from './routes/achievementRoutes.js';
import actionRoutes from './routes/actionRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import learningRoutes from './routes/learningRoutes.js';
import managementRoutes from './routes/managementRoutes.js';
import memoryRoutes from './routes/memoryRoutes.js';
import stateRoutes from './routes/stateRoutes.js';
import summaryRoutes from './routes/summaryRoutes.js';
import sttRoutes from './routes/sttRoutes.js';
import ttsRoutes from './routes/ttsRoutes.js';
import { handleChat } from './services/chatService.js';
import { sendData, sendError } from './lib/apiResponse.js';
import { createRequestLogger } from './lib/logger.js';
import { ensureMemoryStore } from './storage/memoryStore.js';

export async function createApp({ logger } = {}) {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const frontendDistDir = path.join(__dirname, '..', 'frontend', 'dist');

  app.use(cors());
  app.use(express.json({ limit: '12mb' }));
  if (logger) {
    app.use(createRequestLogger(logger));
  }
  app.use(express.static(frontendDistDir));

  await ensureMemoryStore();

  app.post('/api/reflect', async (req, res, next) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

      if (!message) {
        return sendError(res, 400, 'message is required', 'message_required');
      }

      const result = await handleChat(message);
      return res.json({
        text: result.reply,
        result
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api', (_req, res) => {
    const ttsAvailable = Boolean(process.env.SILICONFLOW_API_KEY);
    sendData(res, {
      name: 'Margin',
      status: 'ui-connected',
      message: 'Margin API is connected to the paper-and-ink desktop interface.',
      endpoints: ['/health', '/state', '/actions', '/chat', '/memory', '/summary', '/learning', '/management', '/achievements', '/tts', '/stt'],
      capabilities: { tts: ttsAvailable, stt: ttsAvailable }
    });
  });

  app.get('/health', (_req, res) => {
    sendData(res, { status: 'ok', name: 'Margin' });
  });

  app.use('/chat', chatRoutes);
  app.use('/state', stateRoutes);
  app.use('/actions', actionRoutes);
  app.use('/achievements', achievementRoutes);
  app.use('/learning', learningRoutes);
  app.use('/management', managementRoutes);
  app.use('/memory', memoryRoutes);
  app.use('/summary', summaryRoutes);
  app.use('/stt', sttRoutes);
  app.use('/tts', ttsRoutes);

  app.use((err, req, res, _next) => {
    if (logger) {
      logger.error(err.message || 'Unhandled Margin error', {
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
      err.message || 'Margin became quiet for a moment.',
      err.code || 'internal_error'
    );
  });

  return app;
}
