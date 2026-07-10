import { fetchWithTimeout } from '../../providers/fetchWithTimeout.js';
import { providerErrorFromResponse } from '../../providers/providerError.js';
import {
  normalizeTokenUsage,
  readProviderJson,
  readProviderTraceId,
  requireProviderText
} from '../../providers/jsonResponse.js';

const BASE_URL = 'https://api.openai.com/v1/chat/completions';

export function createOpenAIProvider({
  env = process.env,
  fetchImpl = global.fetch,
  timeoutMs = 20_000
} = {}) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = env.OPENAI_MODEL || 'gpt-4.1-mini';

  return {
    name: 'openai',
    model,
    async generateText({ messages }) {
      const response = await fetchWithTimeout(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      }, { provider: 'openai', timeoutMs, fetchImpl });

      if (!response.ok) {
        throw await providerErrorFromResponse('openai', response, [apiKey]);
      }
      const payload = await readProviderJson('openai', response, [apiKey]);
      return {
        text: requireProviderText('openai', payload.choices?.[0]?.message?.content, response),
        provider: 'openai',
        model: payload.model || model,
        traceId: readProviderTraceId(response),
        usage: normalizeTokenUsage(payload.usage)
      };
    }
  };
}
