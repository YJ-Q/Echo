import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'siliconflow', 'local'];
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, '..', '..');

export function loadRuntimeConfig(
  env = process.env,
  {
    rootDir = defaultRootDir,
    pathExists = fs.existsSync
  } = {}
) {
  const port = parsePort(env.PORT);
  const warnings = [];
  const providerSetting = resolveCompatValue(
    env,
    'MARGIN_LLM_PROVIDER',
    'ECHO_LLM_PROVIDER',
    'local',
    warnings
  );
  const llmProvider = providerSetting.value.toLowerCase();
  const nodeEnv = (env.NODE_ENV || 'development').trim().toLowerCase();
  const logLevel = resolveCompatValue(
    env,
    'MARGIN_LOG_LEVEL',
    'ECHO_LOG_LEVEL',
    'info',
    warnings
  ).value.toLowerCase();
  const dbPath = resolveDatabasePath({ env, rootDir, pathExists, warnings });
  const errors = [];
  const marginCoreEnabled = parseBoolean(env.MARGIN_CORE_ENABLED, 'MARGIN_CORE_ENABLED', false, errors);

  if (!SUPPORTED_PROVIDERS.includes(llmProvider)) {
    errors.push(`Unsupported ${providerSetting.source === 'default' ? 'MARGIN_LLM_PROVIDER' : providerSetting.source}: ${llmProvider}`);
  }

  if (llmProvider === 'openai' && !env.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY is not set; Margin will fall back to the local provider if OpenAI fails.');
  }

  if (llmProvider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY is not set; Margin will fall back to the local provider if Anthropic fails.');
  }

  if (llmProvider === 'siliconflow' && !env.SILICONFLOW_API_KEY) {
    warnings.push('SILICONFLOW_API_KEY is not set; Margin will fall back to the local provider if SiliconFlow fails.');
  }

  if (env.SILICONFLOW_API_KEY) {
    warnings.push('SiliconFlow API is enabled for configured features.');
  } else {
    warnings.push('SILICONFLOW_API_KEY is not set; /tts will remain unavailable.');
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid Margin configuration:\n- ${errors.join('\n- ')}`);
    error.code = 'invalid_runtime_config';
    throw error;
  }

  return {
    port,
    nodeEnv,
    llmProvider,
    logLevel,
    dbPath,
    marginCoreEnabled,
    warnings
  };
}

function parseBoolean(value, name, fallback, errors) {
  if (value === undefined || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  errors.push(`${name} must be true or false`);
  return fallback;
}

function resolveCompatValue(env, marginKey, echoKey, fallback, warnings) {
  const marginValue = String(env[marginKey] || '').trim();
  const echoValue = String(env[echoKey] || '').trim();

  if (marginValue) {
    if (echoValue) {
      warnings.push(`${echoKey} is ignored because ${marginKey} is set.`);
    }
    return { value: marginValue, source: marginKey };
  }

  if (echoValue) {
    warnings.push(`${echoKey} is deprecated; use ${marginKey}.`);
    return { value: echoValue, source: echoKey };
  }

  return { value: fallback, source: 'default' };
}

function resolveDatabasePath({ env, rootDir, pathExists, warnings }) {
  const setting = resolveCompatValue(
    env,
    'MARGIN_DB_PATH',
    'ECHO_DB_PATH',
    '',
    warnings
  );

  if (setting.value) {
    return path.resolve(rootDir, setting.value);
  }

  const marginPath = path.join(rootDir, 'data', 'margin.sqlite');
  const echoPath = path.join(rootDir, 'data', 'echo.sqlite');
  const marginExists = pathExists(marginPath);
  const echoExists = pathExists(echoPath);

  if (marginExists) {
    if (echoExists) {
      warnings.push('A legacy database also exists at data/echo.sqlite; it was not merged automatically.');
    }
    return marginPath;
  }

  if (echoExists) {
    warnings.push('Using the legacy database at data/echo.sqlite; set MARGIN_DB_PATH to migrate explicitly.');
    return echoPath;
  }

  return marginPath;
}

function parsePort(value) {
  const parsed = Number.parseInt(value || '3000', 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 3000;
  }

  return parsed;
}
