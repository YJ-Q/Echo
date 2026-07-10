import 'dotenv/config';
import { probeProvider } from '../src/services/providerProbeService.js';
import { createTtsProvider } from '../src/services/ttsProvider.js';

const options = parseArgs(process.argv.slice(2));

try {
  let audio;
  if (options.capability === 'stt') {
    const tts = createTtsProvider({ env: process.env });
    if (!tts) {
      const error = new Error('SiliconFlow is not configured');
      error.code = 'provider_not_configured';
      throw error;
    }
    const sample = await tts.synthesize('Margin');
    audio = {
      buffer: Buffer.from(sample.data, 'base64'),
      filename: 'margin-provider-probe.mp3',
      mimeType: sample.mimeType
    };
  }

  const result = await probeProvider({
    provider: options.provider,
    capability: options.capability,
    env: process.env,
    audio
  });
  console.log(
    `PASS provider=${result.provider} capability=${result.capability} model=${result.model} latency_ms=${result.latencyMs} trace=${result.traceId || 'none'}`
  );
} catch (error) {
  console.error(
    `FAIL provider=${options.provider} capability=${options.capability} code=${error?.code || 'provider_probe_failed'} trace=${error?.traceId || 'none'}`
  );
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = Object.fromEntries(args.map((entry) => {
    const [key, ...rest] = entry.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }));
  return {
    provider: values.provider || 'siliconflow',
    capability: values.capability || 'conversation'
  };
}
