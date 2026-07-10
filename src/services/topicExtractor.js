const GENERIC_TOPIC = '这件事';

export function extractLearningTopic(input) {
  const normalized = String(input || '').trim();
  const captured = captureTopicAfterLearningCue(normalized);
  const cleaned = normalizeTopic(captured || normalized);

  return cleaned || GENERIC_TOPIC;
}

function captureTopicAfterLearningCue(input) {
  const patterns = [
    /(?:i\s+(?:want|wanna|would like)\s+to\s+learn|teach me|help me study|learn|study)\s+(?:about\s+|how\s+to\s+)?(.+)/i,
    /(?:我想学|我想学习|想学|学习|教我|帮我学(?:习)?|帮我学习)\s*(?:一下|一下关于|关于|怎么|如何)?\s*(.+)/i
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

function normalizeTopic(value) {
  const topic = splitTopicTail(String(value || '')
    .replace(/\s+/g, ' ')
    .trim())
    .replace(/^["'“”‘’「」『』（）()【】\[\]{}<>]+/, '')
    .replace(/["'“”‘’「」『』（）()【】\[\]{}<>]+$/, '')
    .replace(/^(?:about|on|how to|a|an|the|one|some|this|that|my|your|our|their)\s+/i, '')
    .replace(/^(?:关于|有关|怎么|如何|一个|一门|一项|一段|一套|一下|一下子|这门|这个|那个|入门|基础|简单)\s*/i, '')
    .replace(/[.,!?;:，。！？；、]+$/g, '')
    .trim();

  if (isGenericTopic(topic)) {
    return '';
  }

  return normalizeKnownTopic(topic);
}

function splitTopicTail(topic) {
  return topic.split(
    /\s*(?:\.\s*help me study\b|\.\s*please help(?: me)?(?: study)?\b|\.\s*thanks?\b|\.\s*thank you\b|\bhelp me study\b|\bplease help(?: me)?(?: study)?\b|\bbecause\b|\bbut\b|\band\b|\bso\b|\bthen\b|\bhowever\b|\bfinally\b|\brecently\b|, but|, because|, so|, and|, however|，但|，因为|，所以|，不过|，而且|，然后|，接着|，并且|，同时|，此外|，另外|，顺便|，谢谢|，感谢|但是|因为|所以|不过|而且|然后|接着|并且|同时|此外|另外|顺便|谢谢|感谢|[，。！？；!?:;])\s*/i
  )[0];
}

function isGenericTopic(value) {
  const normalized = value.toLowerCase().trim();

  return !normalized || [
    'i want to learn',
    'learn',
    'study',
    'help me study',
    'teach me',
    'want to learn',
    'want to study',
    'want to learn about',
    'i want to learn about',
    '我想学',
    '我想学习',
    '想学',
    '学习',
    '教我',
    '帮我学',
    '帮我学习',
    '一下',
    '一下关于',
    '关于',
    '东西',
    '这件事',
    '技能',
    '知识'
  ].includes(normalized);
}

function normalizeKnownTopic(value) {
  const compact = value.toLowerCase().replace(/\s+/g, '');
  const aliases = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    node: 'Node.js',
    nodejs: 'Node.js',
    'node.js': 'Node.js',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    py: 'Python',
    python: 'Python'
  };

  return aliases[compact] || value;
}
