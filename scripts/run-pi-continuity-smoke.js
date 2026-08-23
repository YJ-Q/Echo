import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPiContinuitySmoke } from '../src/runtime/pi/piContinuitySmoke.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = process.env.MARGIN_PI_PROVIDER;
const modelId = process.env.MARGIN_PI_MODEL;
const baseUrl = process.env.MARGIN_PI_BASE_URL ?? (provider === 'yapi' ? 'https://yapi.click/v1' : undefined);
const api = process.env.MARGIN_PI_API ?? (provider === 'yapi' ? 'openai-responses' : undefined);
const apiKeyEnvironmentName = process.env.MARGIN_PI_API_KEY_ENV ?? (provider === 'yapi' ? 'YAPI_API_KEY' : undefined);
const apiKey = apiKeyEnvironmentName ? process.env[apiKeyEnvironmentName] : undefined;

const result = await runPiContinuitySmoke({
  repositoryRoot,
  dataDir: path.join(repositoryRoot, 'data', 'pi-continuity-smoke'),
  provider,
  modelId,
  customProvider: baseUrl && api && apiKey ? { baseUrl, api, apiKey } : undefined
});

process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
process.exitCode = result.exitCode;
