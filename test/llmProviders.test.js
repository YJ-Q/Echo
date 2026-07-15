import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider } from '../src/services/llm/providers/openaiProvider.js';
import { createAnthropicProvider } from '../src/services/llm/providers/anthropicProvider.js';
import { createSiliconFlowProvider } from '../src/services/llm/providers/siliconflowProvider.js';
import { isProviderError } from '../src/services/providers/providerError.js';

const messages = [
  { role: 'system', content: 'System guidance' },
  { role: 'user', content: 'Hello' }
];

test('conversation adapters expose supported default model ids', () => {
  assert.equal(createOpenAIProvider({ env: { OPENAI_API_KEY: 'test-key' } }).model, 'gpt-4.1-mini');
  assert.equal(
    createAnthropicProvider({ env: { ANTHROPIC_API_KEY: 'test-key' } }).model,
    'claude-sonnet-4-6'
  );
  assert.equal(
    createSiliconFlowProvider({ env: { SILICONFLOW_API_KEY: 'test-key' } }).model,
    'deepseek-ai/DeepSeek-V3.2'
  );
});

test('OpenAI adapter sends Chat Completions and normalizes metadata', async () => {
  const calls = [];
  const provider = createOpenAIProvider({
    env: { OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'gpt-test' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        model: 'gpt-test-2026-01-01',
        choices: [{ message: { content: '  OpenAI reply  ' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 }
      }, { 'x-request-id': 'openai_req' });
    }
  });

  const result = await provider.generateText({ messages });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(body.model, 'gpt-test');
  assert.deepEqual(body.messages, messages);
  assert.deepEqual(result, {
    text: 'OpenAI reply',
    provider: 'openai',
    model: 'gpt-test-2026-01-01',
    traceId: 'openai_req',
    usage: { inputTokens: 12, outputTokens: 4 }
  });
});

test('Anthropic adapter moves system content outside the messages array', async () => {
  const calls = [];
  const provider = createAnthropicProvider({
    env: { ANTHROPIC_API_KEY: 'test-anthropic-key', ANTHROPIC_MODEL: 'claude-test' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        model: 'claude-test-2026',
        content: [{ type: 'text', text: ' Anthropic reply ' }],
        usage: { input_tokens: 9, output_tokens: 3 }
      }, { 'request-id': 'anthropic_req' });
    }
  });

  const result = await provider.generateText({ messages });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'test-anthropic-key');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'System guidance');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
  assert.deepEqual(result, {
    text: 'Anthropic reply',
    provider: 'anthropic',
    model: 'claude-test-2026',
    traceId: 'anthropic_req',
    usage: { inputTokens: 9, outputTokens: 3 }
  });
});

test('SiliconFlow adapter sends Chat Completions and captures its trace id', async () => {
  const calls = [];
  const provider = createSiliconFlowProvider({
    env: { SILICONFLOW_API_KEY: 'test-silicon-key', SILICONFLOW_MODEL: 'sf-test' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        model: 'sf-test',
        choices: [{ message: { content: ' SiliconFlow reply ' } }],
        usage: { prompt_tokens: 7, completion_tokens: 5 }
      }, { 'x-siliconcloud-trace-id': 'sf_req' });
    }
  });

  const result = await provider.generateText({ messages });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-silicon-key');
  assert.equal(body.model, 'sf-test');
  assert.deepEqual(body.messages, messages);
  assert.deepEqual(result, {
    text: 'SiliconFlow reply',
    provider: 'siliconflow',
    model: 'sf-test',
    traceId: 'sf_req',
    usage: { inputTokens: 7, outputTokens: 5 }
  });
});

test('conversation adapters classify rate limits consistently', async () => {
  const cases = [
    ['openai', createOpenAIProvider, { OPENAI_API_KEY: 'test-key' }],
    ['anthropic', createAnthropicProvider, { ANTHROPIC_API_KEY: 'test-key' }],
    ['siliconflow', createSiliconFlowProvider, { SILICONFLOW_API_KEY: 'test-key' }]
  ];

  for (const [name, factory, env] of cases) {
    const provider = factory({
      env,
      fetchImpl: async () => new Response('rate limited test-key', { status: 429 })
    });
    const error = await captureError(() => provider.generateText({ messages }));

    assert.equal(isProviderError(error), true, name);
    assert.equal(error.code, 'provider_rate_limited', name);
    assert.equal(error.provider, name);
    assert.equal(error.detail.includes('test-key'), false);
  }
});

test('conversation adapters reject invalid JSON and empty text', async () => {
  const invalidJson = createOpenAIProvider({
    env: { OPENAI_API_KEY: 'test-key' },
    fetchImpl: async () => new Response('not json', { status: 200 })
  });
  const emptyText = createSiliconFlowProvider({
    env: { SILICONFLOW_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '   ' } }] })
  });

  assert.equal((await captureError(() => invalidJson.generateText({ messages }))).code, 'provider_invalid_json');
  assert.equal((await captureError(() => emptyText.generateText({ messages }))).code, 'provider_empty_response');
});

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}
