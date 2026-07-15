import { createHash } from 'node:crypto';
import { extractLearningTopic } from './topicExtractor.js';

const MEETING_EXPRESSION_CUES = ['会议', '开会', '表达', '发言', '不敢说', '说不完整'];
const REPEAT_CUES = ['总是', '经常', '每次', '反复', '一直'];
const CONCERN_CUES = ['担心', '害怕', '不敢', '焦虑', '紧张', '卡住'];

export function buildGrowthSuggestion({ message, analysis = {} }) {
  const input = String(message || '').trim();
  if (!input) return null;

  const meetingExpression = includesAny(input, MEETING_EXPRESSION_CUES)
    && includesAny(input, CONCERN_CUES);
  const explicitLearning = analysis.intent === 'learning';
  const repeatedStruggle = includesAny(input, REPEAT_CUES)
    && (analysis.intent === 'struggle' || includesAny(input, CONCERN_CUES));

  if (!meetingExpression && !explicitLearning && !repeatedStruggle) return null;

  const topic = meetingExpression
    ? '在会议中更完整地表达'
    : extractLearningTopic(input);
  const normalized = `${topic}|${input}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);

  return {
    key: `growth:${digest}`,
    topic,
    reason: meetingExpression
      ? '你反复提到对表达不完整的担心，这可能值得用一个很小的练习继续看看。'
      : `“${topic}”已经出现了一个可以持续练习的方向。`,
    experiment: meetingExpression
      ? '下一次会议先完整说完一个观点，再停下来听回应。'
      : `先用十分钟完成一个关于“${topic}”的最小例子。`,
    source_input: input,
    status: 'pending'
  };
}

function includesAny(text, cues) {
  return cues.some((cue) => text.includes(cue));
}
