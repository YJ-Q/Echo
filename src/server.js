import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadRuntimeConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { configureProviderRegistry } from './services/llm/providerRegistry.js';
import { configureMemoryStore } from './storage/memoryStore.js';

dotenv.config();

export async function main({ env = process.env, stderr = process.stderr } = {}) {
  if (env.MARGIN_ENABLE_LEGACY_API !== 'true') {
    stderr.write('legacy_api_disabled: use npm run legacy:api for the deprecated server\n');
    return 1;
  }
  const config = loadRuntimeConfig(env);
  configureMemoryStore({ dbPath: config.dbPath });
  configureProviderRegistry({ requestedProvider: config.llmProvider });
  const logger = createLogger(config.logLevel);
  const app = await createApp({ logger });

  for (const warning of config.warnings) logger.warn(warning);

  await new Promise((resolve, reject) => {
    const server = app.listen(config.port, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  logger.info(`Deprecated Margin backend listening on http://127.0.0.1:${config.port}`, {
    provider: config.llmProvider,
    node_env: config.nodeEnv,
    database: path.basename(config.dbPath)
  });
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
