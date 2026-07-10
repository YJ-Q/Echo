import { fetchWithTimeout } from '../../providers/fetchWithTimeout.js';
import { providerErrorFromResponse } from '../../providers/providerError.js';
import {
  normalizeTokenUsage,
  readProviderJson,
  readProviderTraceId,
  requireProviderText
} from '../../providers/jsonResponse.js';

const BASE_URL = 'https://api.anthropic.com/v1/messages';

export function createAnthropicProvider({
  env = process.env,
  fetchImpl = global.fetch,
  timeoutMs = 20_000
} = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

  return {
    name: 'anthropic',
    model,
    async generateText({ messages }) {
      const system = messages.find((entry) => entry.role === 'system')?.content || '';
      const userMessages = messages
        .filter((entry) => entry.role !== 'system')
        .map((entry) => ({
          role: entry.role === 'assistant' ? 'assistant' : 'user',
          content: entry.content
        }));
      const response = await fetchWithTimeout(BASE_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          system,
          max_tokens: 400,
          temperature: 0.7,
          messages: userMessages
        })
      }, { provider: 'anthropic', timeoutMs, fetchImpl });

      if (!response.ok) {
        throw await providerErrorFromResponse('anthropic', response, [apiKey]);
      }
      const payload = await readProviderJson('anthropic', response, [apiKey]);
      const content = payload.content?.find((entry) => entry.type === 'text')?.text;
      return {
        text: requireProviderText('anthropic', content, response),
        provider: 'anthropic',
        model: payload.model || model,
        traceId: readProviderTraceId(response),
        usage: normalizeTokenUsage(payload.usage)
      };
    }
  };
}
