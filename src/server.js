import dotenv from 'dotenv';
import { createApp } from './app.js';
import { loadRuntimeConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';

dotenv.config();

const config = loadRuntimeConfig();
const logger = createLogger(config.logLevel);
const app = await createApp({ logger });

for (const warning of config.warnings) {
  logger.warn(warning);
}

app.listen(config.port, () => {
  logger.info(`Margin backend listening on http://localhost:${config.port}`, {
    provider: config.llmProvider,
    node_env: config.nodeEnv
  });
});
