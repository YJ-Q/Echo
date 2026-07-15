import { createOpenAIProvider } from './llm/providers/openaiProvider.js';
import { createAnthropicProvider } from './llm/providers/anthropicProvider.js';
import { createSiliconFlowProvider } from './llm/providers/siliconflowProvider.js';
import { createTtsProvider } from './ttsProvider.js';
import { createSttProvider } from './sttProvider.js';
import { ProviderError } from './providers/providerError.js';

const conversationFactories = {
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
  siliconflow: createSiliconFlowProvider
};

export async function probeProvider({
  capability,
  provider,
  env = process.env,
  fetchImpl = global.fetch,
  audio
}) {
  const startedAt = performance.now();
  let model;
  let traceId = null;

  if (capability === 'conversation' && conversationFactories[provider]) {
    const adapter = conversationFactories[provider]({ env, fetchImpl });
    assertConfigured(adapter, provider);
    const result = await adapter.generateText({
      messages: [{ role: 'user', content: 'Reply with exactly: MARGIN_OK' }]
    });
    model = result.model;
    traceId = result.traceId;
  } else if (capability === 'tts' && provider === 'siliconflow') {
    const adapter = createTtsProvider({ env, fetchImpl });
    assertConfigured(adapter, provider);
    const result = await adapter.synthesize('Margin');
    model = adapter.model;
    traceId = result.traceId || null;
  } else if (capability === 'stt' && provider === 'siliconflow') {
    const adapter = createSttProvider({ env, fetchImpl });
    assertConfigured(adapter, provider);
    if (!audio) {
      throw new ProviderError('provider_probe_audio_required', 'STT probe requires an audio sample', {
        provider,
        status: 400,
        retryable: false
      });
    }
    const options = Buffer.isBuffer(audio)
      ? { filename: 'margin-probe.wav', mimeType: 'audio/wav' }
      : undefined;
    await adapter.transcribe(audio, options);
    model = adapter.model;
  } else {
    throw new ProviderError(
      'provider_probe_unsupported',
      `Probe is not supported for ${provider}/${capability}`,
      { provider, status: 400, retryable: false }
    );
  }

  return {
    ok: true,
    capability,
    provider,
    model,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    traceId
  };
}

function assertConfigured(adapter, provider) {
  if (!adapter) {
    throw new ProviderError('provider_not_configured', `${provider} is not configured`, {
      provider,
      status: 503,
      retryable: false
    });
  }
}
