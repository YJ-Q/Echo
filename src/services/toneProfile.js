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

export function formatEchoReply(rawReply) {
  const reply = shapeWePerspective(String(rawReply || '').trim());
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
  const weCount = countMatches(reply, /我们|we/gi);
  const youCount = countMatches(reply, /你|you/gi);
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
    .replace(/\bYou should\b/gi, 'We can')
    .replace(/\bYou need to\b/gi, 'We need to')
    .replace(/\bYou can\b/gi, 'We can')
    .replace(/\bYour\b/g, 'Our')
    .replace(/\byour\b/g, 'our')
    .replace(/\bPlease tell me\b/gi, '')
    .replace(/作为一个 AI/g, '')
    .replace(/作为 AI/g, '')
    .replace(/As an AI[^,.，。]*/gi, '')
    .replace(/\s{3,}/g, '  ')
    .trim();
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length || 0;
}

const CHATBOT_PHRASES = [
  '作为一个 AI',
  '作为 AI',
  '我可以帮你',
  '很高兴为你',
  '请告诉我',
  '有什么可以帮助',
  'As an AI',
  'How can I help you',
  'I can help you'
];
