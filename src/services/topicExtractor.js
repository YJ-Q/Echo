export function extractLearningTopic(input) {
  const normalized = input.trim();
  const captured = captureTopicAfterLearningCue(normalized);
  const cleaned = normalizeTopic(captured || normalized);

  return cleaned || '这件事';
}

function captureTopicAfterLearningCue(input) {
  const patterns = [
    /(?:i want to learn|teach me|help me study|learn|study)\s+(.+)/i,
    /(?:我想学|想学|学习|教我|帮我学|帮我学习)\s*(.+)/i
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
  return value
    .split(/\bbut\b|\bbecause\b|\bso\b|, but|, because|, so|，但|，不过|，因为|，所以|但是|可是|因为|所以|只是|一直|总是/i)[0]
    .replace(/^(一个|一点|一些|怎么|如何|关于|有关)\s*/i, '')
    .replace(/[，。,.!?！？；;：:]$/g, '')
    .trim();
}
