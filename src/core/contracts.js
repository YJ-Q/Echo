import { createHash } from 'node:crypto';

export class CoreContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CoreContractError';
    this.code = code;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function digestInput(input) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

export function ok(data, auditId) {
  return auditId === undefined ? { ok: true, data } : { ok: true, data, auditId };
}

export function fail(code, options = {}) {
  const error = { code, retryable: options.retryable ?? false };
  if (options.details !== undefined) error.details = options.details;
  const result = { ok: false, error };
  if (options.auditId !== undefined) result.auditId = options.auditId;
  return result;
}

export function requireFields(input, fields) {
  const missing = fields.filter((field) => {
    const value = input?.[field];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
  if (missing.length > 0) {
    throw new CoreContractError('invalid_request', `Missing required fields: ${missing.join(', ')}`);
  }
}
