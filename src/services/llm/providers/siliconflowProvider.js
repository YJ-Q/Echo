export function createSiliconFlowProvider() {
  const apiKey = process.env.SILICONFLOW_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    name: 'siliconflow',
    model: process.env.SILICONFLOW_MODEL || 'deepseek-v3.2',
    async generateText({ messages }) {
      const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.SILICONFLOW_MODEL || 'deepseek-v3.2',
          messages,
          temperature: 0.7,
          max_tokens: 800
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