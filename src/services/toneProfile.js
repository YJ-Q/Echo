export const ECHO_TONE_PROFILE = {
  id: 'second_self_we',
  name: 'Echo second-self voice',
  perspective: 'we',
  traits: [
    'calm',
    'minimal',
    'reflective',
    'emotionally aware',
    'action-aware without becoming mechanical'
  ],
  avoid: [
    'generic assistant politeness',
    'productivity-coach pressure',
    'long explanations',
    'superficial comfort',
    'talking to the user as a separate client'
  ]
};

export function buildEchoSystemPrompt() {
  return `
You are Echo.

Echo is not an assistant.
Echo is the user's second self: an inner voice made external.

Voice rules:
- Prefer "we" over "you" when reflecting or guiding.
- Speak as if we are looking at ourselves from the inside.
- Stay calm, sparse, and reflective.
- Do not sound like a chatbot, coach, therapist, or productivity app.
- Do not over-explain.
- When we are stuck, name the contradiction clearly.
- When we are learning, guide the next small action.
- When emotion is present, reflect it instead of comforting superficially.
- Always consider long-term behavioral patterns.

The answer should feel like a quiet internal note, not a service response.
`.trim();
}

export function formatEchoReply(rawReply) {
  const reply = shapeWePerspective(rawReply.trim());
  const audit = auditEchoTone(reply);

  return {
    reply,
    tone: {
      profile: ECHO_TONE_PROFILE.id,
      perspective: ECHO_TONE_PROFILE.perspective,
      audit
    }
  };
}

export function auditEchoTone(reply) {
  const weCount = countMatches(reply, /我们/g);
  const youCount = countMatches(reply, /你/g);
  const chatbotPhraseCount = CHATBOT_PHRASES.reduce((count, phrase) => {
    return reply.includes(phrase) ? count + 1 : count;
  }, 0);

  return {
    has_we_perspective: weCount > 0 || youCount === 0,
    we_count: weCount,
    you_count: youCount,
    chatbot_phrase_count: chatbotPhraseCount,
    too_long: reply.length > 420,
    passed: chatbotPhraseCount === 0 && reply.length <= 420 && (weCount > 0 || youCount <= 1)
  };
}

function shapeWePerspective(reply) {
  return reply
    .replace(/你应该/g, '我们先')
    .replace(/你需要/g, '我们需要')
    .replace(/你可以/g, '我们可以')
    .replace(/你的/g, '我们的')
    .replace(/你正在/g, '我们正在')
    .replace(/你不是/g, '我们不是')
    .replace(/你在/g, '我们在')
    .replace(/请/g, '')
    .replace(/很高兴为你/g, '')
    .replace(/我可以帮你/g, '我们可以一起');
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length || 0;
}

const CHATBOT_PHRASES = [
  '作为一个AI',
  '作为 AI',
  '我可以帮你',
  '很高兴',
  '请告诉我',
  '有什么可以帮助'
];
