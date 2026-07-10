import { fetchWithTimeout } from '../../providers/fetchWithTimeout.js';
import { providerErrorFromResponse } from '../../providers/providerError.js';
import {
  normalizeTokenUsage,
  readProviderJson,
  readProviderTraceId,
  requireProviderText
} from '../../providers/jsonResponse.js';

const BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions';

export function createSiliconFlowProvider({
  env = process.env,
  fetchImpl = global.fetch,
  timeoutMs = 20_000
} = {}) {
  const apiKey = env.SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  const model = env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3.2';

  return {
    name: 'siliconflow',
    model,
    async generateText({ messages }) {
      const response = await fetchWithTimeout(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      }, { provider: 'siliconflow', timeoutMs, fetchImpl });

      if (!response.ok) {
        throw await providerErrorFromResponse('siliconflow', response, [apiKey]);
      }
      const payload = await readProviderJson('siliconflow', response, [apiKey]);
      return {
        text: requireProviderText('siliconflow', payload.choices?.[0]?.message?.content, response),
        provider: 'siliconflow',
        model: payload.model || model,
        traceId: readProviderTraceId(response),
        usage: normalizeTokenUsage(payload.usage)
      };
    }
  };
}
