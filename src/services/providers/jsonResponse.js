import { ProviderError, sanitizeProviderDetail } from './providerError.js';

export async function readProviderJson(provider, response, secrets = []) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ProviderError('provider_invalid_json', `${provider} returned invalid JSON`, {
      provider,
      status: 502,
      retryable: false,
      traceId: readProviderTraceId(response),
      detail: sanitizeProviderDetail(raw, secrets),
      cause
    });
  }
}

export function requireProviderText(provider, value, response) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new ProviderError('provider_empty_response', `${provider} returned no response text`, {
      provider,
      status: 502,
      retryable: false,
      traceId: readProviderTraceId(response)
    });
  }
  return text;
}

export function readProviderTraceId(response) {
  return response.headers.get('x-request-id')
    || response.headers.get('request-id')
    || response.headers.get('x-siliconcloud-trace-id')
    || null;
}

export function normalizeTokenUsage(usage = {}) {
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null
  };
}
