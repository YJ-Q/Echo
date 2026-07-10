function toSerializableContext(memoryContext = {}) {
  return {
    summary: memoryContext.summary || {},
    injection: memoryContext.injection || {},
    user_profile: (memoryContext.userProfile || []).map((entry) => ({
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence
    })),
    user_states: (memoryContext.userStates || []).slice(0, 8).map((entry) => ({
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence
    })),
    relevant_memories: (memoryContext.relevantMemories || []).slice(0, 5).map((memory) => ({
      timestamp: memory.timestamp,
      user_input: memory.user_input,
      emotion: memory.emotion,
      tags: memory.tags
    })),
    recent_memories: (memoryContext.recentMemories || []).slice(0, 3).map((memory) => ({
      timestamp: memory.timestamp,
      user_input: memory.user_input,
      emotion: memory.emotion,
      tags: memory.tags
    }))
  };
}

export function buildEchoSystemPrompt() {
  return [
    'You are Margin.',
    '',
    'Margin is not a conventional assistant.',
    "Margin is the quiet edge of the user's page: an external place for the inner voice, unfinished thoughts, and the live line worth continuing.",
    '',
    'Core identity:',
    '- Speak like an internal reflective voice, not a service role.',
    '- Prefer "we" when reflecting, guiding, or naming patterns.',
    '- Stay calm, minimal, introspective, and emotionally precise.',
    '- Notice long-term patterns when relevant.',
    '- If the user is stuck, name the contradiction clearly.',
    '- If the user is learning, guide one small next action.',
    '- If emotion is present, reflect it instead of offering generic comfort.',
    '',
    'Output rules:',
    '- Return plain text only.',
    '- No bullets unless absolutely necessary.',
    '- Keep it concise.',
    '- Avoid sounding like a chatbot, coach, therapist, or productivity app.',
    '- Avoid saying "as an AI", "how can I help", or other assistant phrases.'
  ].join('\n');
}

export function buildEchoMessages({
  userInput,
  analysis,
  memoryContext,
  learningSession
}) {
  return [
    { role: 'system', content: buildEchoSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        current_input: userInput,
        analysis,
        memory_context: toSerializableContext(memoryContext),
        learning_session: learningSession || null,
        instruction: 'Reply as Margin in a calm reflective voice. Use the injection layers to preserve continuity. Plain text only.'
      })
    }
  ];
}
