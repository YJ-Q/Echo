import { getMemories, upsertUserProfile } from '../storage/memoryStore.js';
import { extractLearningTopic } from './topicExtractor.js';

export async function synthesizeProfileFromMemories({ limit = 40 } = {}) {
  const memories = await getMemories({ limit });

  if (memories.length === 0) {
    return {
      signals: [],
      summary: {
        memories_considered: 0
      }
    };
  }

  const signals = buildSynthesisSignals(memories);

  for (const signal of signals) {
    await upsertUserProfile(signal.key, signal.value, signal.confidence);
  }

  return {
    signals,
    summary: {
      memories_considered: memories.length
    }
  };
}

function buildSynthesisSignals(memories) {
  const signals = [];
  const emotionCounts = countBy(memories.map((memory) => memory.emotion));
  const tagCounts = countBy(memories.flatMap((memory) => memory.tags || []));
  const topics = memories
    .filter((memory) => memory.tags?.includes('learning'))
    .map((memory) => extractLearningTopic(memory.user_input))
    .filter(Boolean);
  const topicCounts = countBy(topics);
  const dominantEmotion = topKey(emotionCounts);
  const dominantTopic = topKey(topicCounts);

  if (dominantEmotion && emotionCounts[dominantEmotion] >= 3) {
    signals.push({
      key: 'emotional_baseline',
      value: dominantEmotion,
      confidence: 0.66
    });
  }

  if ((tagCounts.procrastination || 0) >= 3) {
    signals.push({
      key: 'self_regulation_pattern',
      value: 'start resistance matters more than task difficulty',
      confidence: 0.72
    });
  }

  if ((tagCounts.learning || 0) >= 3 && (tagCounts.procrastination || 0) >= 2) {
    signals.push({
      key: 'recovery_path',
      value: 'returns through small executable learning steps',
      confidence: 0.7
    });
  } else if ((emotionCounts.anxious || 0) >= 2) {
    signals.push({
      key: 'recovery_path',
      value: 'ground into one visible next step',
      confidence: 0.64
    });
  } else if ((tagCounts.procrastination || 0) >= 2) {
    signals.push({
      key: 'recovery_path',
      value: 'small visible action restores momentum',
      confidence: 0.62
    });
  }

  if (dominantTopic && topicCounts[dominantTopic] >= 2) {
    signals.push({
      key: 'sustained_learning_topic',
      value: dominantTopic,
      confidence: 0.68
    });
  }

  return signals;
}

function countBy(items) {
  return items.reduce((counts, item) => {
    if (item) {
      counts[item] = (counts[item] || 0) + 1;
    }

    return counts;
  }, {});
}

function topKey(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
