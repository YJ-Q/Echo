const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'local'];

export function loadRuntimeConfig(env = process.env) {
  const port = parsePort(env.PORT);
  const llmProvider = (env.ECHO_LLM_PROVIDER || '').trim().toLowerCase() || 'local';
  const nodeEnv = (env.NODE_ENV || 'development').trim().toLowerCase();
  const logLevel = (env.ECHO_LOG_LEVEL || 'info').trim().toLowerCase();

  const warnings = [];
  const errors = [];

  if (!SUPPORTED_PROVIDERS.includes(llmProvider)) {
    errors.push(`Unsupported ECHO_LLM_PROVIDER: ${llmProvider}`);
  }

  if (llmProvider === 'openai' && !env.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY is not set; Echo will fall back to the local provider if OpenAI fails.');
  }

  if (llmProvider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY is not set; Echo will fall back to the local provider if Anthropic fails.');
  }

  if (env.SILICONFLOW_API_KEY) {
    warnings.push('SiliconFlow TTS is enabled.');
  } else {
    warnings.push('SILICONFLOW_API_KEY is not set; /tts will remain unavailable.');
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid Echo configuration:\n- ${errors.join('\n- ')}`);
    error.code = 'invalid_runtime_config';
    throw error;
  }

  return {
    port,
    nodeEnv,
    llmProvider,
    logLevel,
    warnings
  };
}

function parsePort(value) {
  const parsed = Number.parseInt(value || '3000', 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return 3000;
  }

  return parsed;
}
