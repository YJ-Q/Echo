import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreContractError, digestInput, fail, ok, requireFields } from '../src/core/contracts.js';
import { decidePermission } from '../src/core/permissions.js';

test('stable result envelopes omit absent optional fields', () => {
  assert.deepEqual(ok({ id: 'p1' }, 'audit-1'), { ok: true, data: { id: 'p1' }, auditId: 'audit-1' });
  assert.deepEqual(fail('version_conflict', { retryable: true, details: { expected: 1, actual: 2 } }), {
    ok: false,
    error: { code: 'version_conflict', retryable: true, details: { expected: 1, actual: 2 } }
  });
});

test('input digest is deterministic for reordered object keys', () => {
  assert.equal(digestInput({ b: 2, a: { d: 4, c: 3 } }), digestInput({ a: { c: 3, d: 4 }, b: 2 }));
  assert.match(digestInput({ a: 1 }), /^[a-f0-9]{64}$/u);
});

test('required field errors are stable and redact input values', () => {
  assert.throws(
    () => requireFields({ requestId: '', secret: 'do-not-leak' }, ['requestId', 'projectId']),
    (error) => error instanceof CoreContractError && error.code === 'invalid_request' &&
      !error.message.includes('do-not-leak') && !error.message.includes('secret')
  );
});

test('permissions default deny and map operations explicitly', () => {
  assert.deepEqual(decidePermission({ operation: 'memory_search', permissions: {} }), {
    decision: 'denied', code: 'permission_denied'
  });
  assert.deepEqual(decidePermission({ operation: 'memory_search', permissions: { memoryRead: true } }), {
    decision: 'allowed', code: 'allowed'
  });
  assert.deepEqual(decidePermission({ operation: 'state_update', permissions: { stateWrite: true } }), {
    decision: 'allowed', code: 'allowed'
  });
});

test('risky action writes require an explicit confirmation reference', () => {
  assert.deepEqual(decidePermission({
    operation: 'action_update', permissions: { actionWrite: true }, riskLevel: 'external_write'
  }), { decision: 'confirmation_required', code: 'confirmation_required' });
  assert.deepEqual(decidePermission({
    operation: 'action_update', permissions: { actionWrite: true }, riskLevel: 'high_risk', confirmationRef: 'confirm-1'
  }), { decision: 'allowed', code: 'allowed' });
});
