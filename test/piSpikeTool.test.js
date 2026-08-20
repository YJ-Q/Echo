import test from 'node:test';
import assert from 'node:assert/strict';
import { MARGIN_SPIKE_TOOL_NAME, marginSpikeEchoTool } from '../src/runtime/pi/piSpikeTool.js';

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
