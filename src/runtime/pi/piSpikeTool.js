import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export const MARGIN_SPIKE_TOOL_NAME = 'margin_spike_echo';

export const marginSpikeEchoTool = defineTool({
  name: MARGIN_SPIKE_TOOL_NAME,
  label: 'Margin Stage 0 Echo',
  description: 'Stage 0 audit-only tool that returns the supplied nonce without side effects.',
  parameters: Type.Object({
    message: Type.String({ description: 'Nonce to echo for the SDK audit.' })
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: 'text', text: params.message }],
    details: { echoed: true },
    isError: false
  })
});

export async function marginSpikeEchoExtension(pi) {
  pi.registerTool(marginSpikeEchoTool);
}
