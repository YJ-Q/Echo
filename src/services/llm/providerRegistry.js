import { createAnthropicProvider } from './providers/anthropicProvider.js';
import { createLocalProvider } from './providers/localProvider.js';
import { createOpenAIProvider } from './providers/openaiProvider.js';
import { createSiliconFlowProvider } from './providers/siliconflowProvider.js';

let configuredProvider = 'local';

export function configureProviderRegistry({ requestedProvider } = {}) {
  configuredProvider = String(requestedProvider || 'local').trim().toLowerCase();
}

export function resolveMarginProvider() {
  const providers = {
    openai: createOpenAIProvider(),
    anthropic: createAnthropicProvider(),
    siliconflow: createSiliconFlowProvider(),
    local: createLocalProvider()
  };

  return providers[configuredProvider] || providers.local;
}

export const resolveEchoProvider = resolveMarginProvider;
