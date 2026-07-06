import dotenv from 'dotenv';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

dotenv.config();

const port = process.env.PORT || 3000;
const app = await createApp();

app.listen(port, () => {
  logger.info({ port, provider: process.env.ECHO_LLM_PROVIDER || 'local' }, 'Echo backend started');
});
