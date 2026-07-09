export class TtsProviderError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TtsProviderError';
    this.code = code;
    this.status = status;
  }
}

export function isTtsProviderError(error) {
  return error instanceof TtsProviderError;
}
