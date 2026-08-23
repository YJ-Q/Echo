import dotenv from 'dotenv';
import path from 'node:path';
import { createApp } from './app.js';
import { loadRuntimeConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { configureProviderRegistry } from './services/llm/providerRegistry.js';
import { configureMemoryStore } from './storage/memoryStore.js';

dotenv.config();

const config = loadRuntimeConfig();
configureMemoryStore({ dbPath: config.dbPath });
configureProviderRegistry({ requestedProvider: config.llmProvider });
const logger = createLogger(config.logLevel);
const app = await createApp({ logger });

for (const warning of config.warnings) {
  logger.warn(warning);
}

app.listen(config.port, () => {
  logger.info(`Margin backend listening on http://localhost:${config.port}`, {
    provider: config.llmProvider,
    node_env: config.nodeEnv,
    database: path.basename(config.dbPath)
  });
});
