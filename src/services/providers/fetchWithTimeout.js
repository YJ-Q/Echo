import { ProviderError } from './providerError.js';

export async function fetchWithTimeout(url, options = {}, {
  provider = 'unknown',
  timeoutMs = 20_000,
  fetchImpl = global.fetch
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: options.signal || controller.signal
    });
  } catch (cause) {
    if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') {
      throw new ProviderError('provider_timeout', `${provider} request timed out`, {
        provider,
        status: 504,
        retryable: true,
        cause
      });
    }
    throw new ProviderError('provider_request_failed', `${provider} request failed before receiving a response`, {
      provider,
      status: 502,
      retryable: true,
      cause
    });
  } finally {
    clearTimeout(timer);
  }
}
