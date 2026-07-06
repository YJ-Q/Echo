const BASE_URL = 'https://api.siliconflow.cn/v1/audio/speech';

const DEFAULTS = {
  model: 'FunAudioLLM/CosyVoice2-0.5B',
  voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
  response_format: 'mp3',
  speed: 1.0
};

export function createTtsProvider() {
  const apiKey = process.env.SILICONFLOW_API_KEY;

  if (!apiKey) {
    console.warn('SILICONFLOW_API_KEY not set; TTS unavailable.');
    return null;
  }

  return {
    name: 'siliconflow',
    model: DEFAULTS.model,
    async synthesize(text) {
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: DEFAULTS.model,
          input: text,
          voice: DEFAULTS.voice,
          response_format: DEFAULTS.response_format,
          speed: DEFAULTS.speed
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`TTS request failed: ${response.status} - ${detail}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return {
        mimeType: 'audio/mpeg',
        data: base64
      };
    }
  };
}

let instance = null;

export function getTtsProvider() {
  if (!instance) {
    instance = createTtsProvider();
  }

  return instance;
}
