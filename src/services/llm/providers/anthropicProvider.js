export function createAnthropicProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    name: 'anthropic',
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    async generateText({ messages }) {
      const system = messages.find((entry) => entry.role === 'system')?.content || '';
      const userContent = messages
        .filter((entry) => entry.role !== 'system')
        .map((entry) => ({
          role: entry.role === 'assistant' ? 'assistant' : 'user',
          content: entry.content
        }));
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
          system,
          max_tokens: 400,
          temperature: 0.7,
          messages: userContent
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Anthropic request failed: ${detail}`);
      }

      const data = await response.json();
      return data.content?.find((entry) => entry.type === 'text')?.text?.trim() || '';
    }
  };
}
