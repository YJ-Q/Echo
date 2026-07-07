const BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions';

export function createSiliconFlowProvider() {
  const apiKey = process.env.SILICONFLOW_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    name: 'siliconflow',
    model: process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3.2',
    async generateText({ messages }) {
      const model = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3.2';
      const response = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`SiliconFlow request failed: ${detail}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    }
  };
}
