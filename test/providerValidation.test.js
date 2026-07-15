import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConversationProvider } from '../electron/providerValidation.js';

test('local provider validation does not perform a supplier request', async () => {
  let calls = 0;
  const result = await validateConversationProvider({
    env: { MARGIN_LLM_PROVIDER: 'local' },
    probe: async () => { calls += 1; }
  });

  assert.deepEqual(result, { skipped: true, provider: 'local' });
  assert.equal(calls, 0);
});

test('remote provider validation probes the selected provider with its environment', async () => {
  const env = {
    MARGIN_LLM_PROVIDER: 'siliconflow',
    SILICONFLOW_API_KEY: 'test-key',
    SILICONFLOW_MODEL: 'test-model'
  };
  const calls = [];
  const result = await validateConversationProvider({
    env,
    probe: async (input) => {
      calls.push(input);
      return {
        ok: true,
        provider: 'siliconflow',
        capability: 'conversation',
        model: 'test-model',
        latencyMs: 42,
        traceId: 'test-trace'
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'siliconflow');
  assert.equal(calls[0].capability, 'conversation');
  assert.equal(calls[0].env, env);
  assert.equal(result.latencyMs, 42);
});
