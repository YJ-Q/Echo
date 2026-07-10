import { probeProvider } from '../src/services/providerProbeService.js';

export async function validateConversationProvider({
  env,
  probe = probeProvider
}) {
  const provider = String(env.MARGIN_LLM_PROVIDER || env.ECHO_LLM_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  if (provider === 'local') {
    return { skipped: true, provider };
  }
  return probe({
    capability: 'conversation',
    provider,
    env
  });
}
