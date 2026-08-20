import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARGIN_SPIKE_TOOL_NAME,
  createMarginSpikeExtension,
  marginSpikeEchoExtension,
  marginSpikeEchoTool
} from '../src/runtime/pi/piSpikeTool.js';

test('spike exposes exactly one audit-only echo tool', async () => {
  assert.equal(MARGIN_SPIKE_TOOL_NAME, 'margin_spike_echo');
  assert.equal(marginSpikeEchoTool.name, MARGIN_SPIKE_TOOL_NAME);
  assert.match(marginSpikeEchoTool.description, /audit-only/i);
  assert.deepEqual(marginSpikeEchoTool.parameters.required, ['message']);

  const result = await marginSpikeEchoTool.execute('call-1', { message: 'nonce-123' });
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'nonce-123' }],
    details: { echoed: true },
    isError: false
  });
});

test('custom provider is registered inline without writing credentials to disk', async () => {
  const providers = [];
  const tools = [];
  const extension = createMarginSpikeExtension({
    providerId: 'yapi',
    baseUrl: 'https://yapi.click/v1',
    api: 'openai-responses',
    apiKey: 'runtime-secret',
    modelId: 'gpt-5.6-terra'
  });
  await extension({
    registerProvider: (id, config) => providers.push([id, config]),
    registerTool: (tool) => tools.push(tool)
  });
  assert.equal(providers[0][0], 'yapi');
  assert.equal(providers[0][1].apiKey, 'runtime-secret');
  assert.equal(providers[0][1].models[0].id, 'gpt-5.6-terra');
  assert.equal(providers[0][1].models[0].api, 'openai-responses');
  assert.deepEqual(tools, [marginSpikeEchoTool]);
});

test('spike registers the tool through one inline extension factory', async () => {
  const registered = [];
  await marginSpikeEchoExtension({ registerTool: (tool) => registered.push(tool) });
  assert.deepEqual(registered, [marginSpikeEchoTool]);
});
