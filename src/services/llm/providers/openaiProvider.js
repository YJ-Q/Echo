export function createOpenAIProvider() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    name: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    async generateText({ messages }) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          messages,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI request failed: ${detail}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    }
  };
}
