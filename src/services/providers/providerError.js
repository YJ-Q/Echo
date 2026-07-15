const MAX_DETAIL_LENGTH = 300;

export class ProviderError extends Error {
  constructor(code, message, {
    provider,
    status = 502,
    upstreamStatus = null,
    retryable = false,
    traceId = null,
    detail = '',
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider || 'unknown';
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.retryable = retryable;
    this.traceId = traceId;
    this.detail = detail;
  }
}

export function isProviderError(error) {
  return error instanceof ProviderError;
}

export function sanitizeProviderDetail(value, secrets = []) {
  let detail = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) {
      detail = detail.split(secret).join('[REDACTED]');
    }
  }
  detail = detail
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return detail.slice(0, MAX_DETAIL_LENGTH);
}

export async function providerErrorFromResponse(provider, response, secrets = []) {
  const detail = sanitizeProviderDetail(await response.text(), secrets);
  const classification = classifyStatus(response.status);
  const traceId = response.headers.get('x-request-id')
    || response.headers.get('request-id')
    || response.headers.get('x-siliconcloud-trace-id')
    || null;

  return new ProviderError(
    classification.code,
    `${provider} request failed with HTTP status ${response.status}`,
    {
      provider,
      status: classification.status,
      upstreamStatus: response.status,
      retryable: classification.retryable,
      traceId,
      detail
    }
  );
}

function classifyStatus(status) {
  if (status === 400 || status === 422) {
    return { code: 'provider_bad_request', status: 502, retryable: false };
  }
  if (status === 401 || status === 403) {
    return { code: 'provider_auth_failed', status: 502, retryable: false };
  }
  if (status === 404) {
    return { code: 'provider_model_unavailable', status: 502, retryable: false };
  }
  if (status === 408) {
    return { code: 'provider_timeout', status: 504, retryable: true };
  }
  if (status === 409) {
    return { code: 'provider_conflict', status: 502, retryable: false };
  }
  if (status === 429) {
    return { code: 'provider_rate_limited', status: 502, retryable: true };
  }
  if (status >= 500) {
    return { code: 'provider_unavailable', status: 502, retryable: true };
  }
  return { code: 'provider_response_error', status: 502, retryable: false };
}
