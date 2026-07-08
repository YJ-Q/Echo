export function extractLearningTopic(input) {
  const normalized = String(input || '').trim();
  const captured = captureTopicAfterLearningCue(normalized);
  const cleaned = normalizeTopic(captured);

  return cleaned || '这件事';
}

function captureTopicAfterLearningCue(input) {
  const patterns = [
    /(?:i\s+(?:want|wanna|would like)\s+to\s+learn|teach me|help me study|learn|study)\s+(?:about\s+|how\s+to\s+)?(.+)/i,
    /(?:我(?:还是|也|真的|想要)?想学|想学|学习一下|学习|教我|帮我(?:学习|学))\s*(?:一下|怎么|如何|关于|有关)?\s*(.*)/i
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
  const topic = String(value || '')
    .split(/\bbut\b|\bbecause\b|\bso\b|\band\b|\brecently\b|, but|, because|, so|，但|，不过|，因为|，所以|，而且|，并且|但是|可是|因为|所以|只是|不过|而且|并且|最近|一直|总是|然后|先/i)[0]
    .replace(/^(一个|一门|一点|一些|这个|这门|怎么|如何|关于|有关|一下|入门|基础)\s*/i, '')
    .replace(/^(我想学|想学|学习|教我|帮我学|帮我学习)\s*/i, '')
    .replace(/[“”"'「」『』（）()[\]{}]/g, '')
    .replace(/[，。,.!?！？；;：:]$/g, '')
    .trim();

  if (isGenericTopic(topic)) {
    return '';
  }

  return normalizeKnownTopic(topic);
}

function isGenericTopic(value) {
  const normalized = value.toLowerCase().trim();

  return !normalized || [
    'i want to learn',
    'learn',
    'study',
    '我想学',
    '想学',
    '学习',
    '教我',
    '帮我学',
    '帮我学习',
    '东西',
    '技能',
    '知识',
    '这件事'
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
