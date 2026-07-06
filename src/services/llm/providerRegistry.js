import { createAnthropicProvider } from './providers/anthropicProvider.js';
import { createLocalProvider } from './providers/localProvider.js';
import { createOpenAIProvider } from './providers/openaiProvider.js';

export function resolveEchoProvider() {
  const requested = (process.env.ECHO_LLM_PROVIDER || '').trim().toLowerCase();
  const providers = {
    openai: createOpenAIProvider(),
    anthropic: createAnthropicProvider(),
    local: createLocalProvider()
  };

  if (requested && providers[requested]) {
    return providers[requested] || providers.local;
  }

  return providers.openai || providers.anthropic || providers.local;
}
