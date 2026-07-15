import { getLearningSessions, getMemories, upsertUserProfile } from '../storage/memoryStore.js';
import { extractLearningTopic } from './topicExtractor.js';

export async function synthesizeProfileFromMemories({ limit = 40 } = {}) {
  const [memories, learningSessions] = await Promise.all([
    getMemories({ limit }),
    getLearningSessions({ limit: 100 })
  ]);

  if (memories.length === 0) {
    return {
      signals: [],
      summary: {
        memories_considered: 0
      }
    };
  }

  const signals = filterConfirmedGrowthSignals(
    buildSynthesisSignals(memories),
    learningSessions
  );

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

export function filterConfirmedGrowthSignals(signals, learningSessions) {
  const confirmedTopics = new Set(
    (learningSessions || []).map((session) => session.topic).filter(Boolean)
  );

  return (signals || []).filter((signal) => (
    signal.key !== 'sustained_learning_topic'
    || confirmedTopics.has(signal.value)
  ));
}

const MIN_EMOTIONAL_BASELINE_SAMPLES = 4;
const MIN_EMOTIONAL_BASELINE_RATIO = 0.6;
const MIN_RECOVERY_PATH_SAMPLES = 4;
const MIN_RECOVERY_PATH_RATIO = 0.5;
const MIN_TOPIC_MAJORITY_RATIO = 0.6;

export function buildSynthesisSignals(memories) {
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
  const totalEmotionSamples = totalCount(emotionCounts);
  const totalTopicSamples = totalCount(topicCounts);
  const dominantEmotionCount = emotionCounts[dominantEmotion] || 0;
  const dominantTopicCount = topicCounts[dominantTopic] || 0;
  const learningCount = tagCounts.learning || 0;
  const procrastinationCount = tagCounts.procrastination || 0;
  const anxiousCount = emotionCounts.anxious || 0;

  if (
    dominantEmotion &&
    dominantEmotionCount >= 3 &&
    totalEmotionSamples >= MIN_EMOTIONAL_BASELINE_SAMPLES &&
    ratioOf(dominantEmotionCount, totalEmotionSamples) >= MIN_EMOTIONAL_BASELINE_RATIO
  ) {
    signals.push({
      key: 'emotional_baseline',
      value: dominantEmotion,
      confidence: 0.66
    });
  }

  if (procrastinationCount >= 3) {
    signals.push({
      key: 'self_regulation_pattern',
      value: 'start resistance matters more than task difficulty',
      confidence: 0.72
    });
  }

  if (
    learningCount >= 3 &&
    procrastinationCount >= 2 &&
    memories.length >= MIN_RECOVERY_PATH_SAMPLES &&
    ratioOf(procrastinationCount, learningCount) >= MIN_RECOVERY_PATH_RATIO
  ) {
    signals.push({
      key: 'recovery_path',
      value: 'returns through small executable learning steps',
      confidence: 0.7
    });
  } else if (
    anxiousCount >= 3 &&
    totalEmotionSamples >= MIN_RECOVERY_PATH_SAMPLES &&
    ratioOf(anxiousCount, totalEmotionSamples) >= MIN_RECOVERY_PATH_RATIO
  ) {
    signals.push({
      key: 'recovery_path',
      value: 'ground into one visible next step',
      confidence: 0.64
    });
  } else if (
    procrastinationCount >= 3 &&
    memories.length >= MIN_RECOVERY_PATH_SAMPLES &&
    ratioOf(procrastinationCount, memories.length) >= MIN_RECOVERY_PATH_RATIO
  ) {
    signals.push({
      key: 'recovery_path',
      value: 'small visible action restores momentum',
      confidence: 0.62
    });
  }

  if (
    dominantTopic &&
    dominantTopicCount >= 2 &&
    hasStableTopicMajority(topicCounts, dominantTopic, totalTopicSamples)
  ) {
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

function totalCount(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function ratioOf(count, total) {
  return total > 0 ? count / total : 0;
}

function hasStableTopicMajority(topicCounts, dominantTopic, totalTopicSamples) {
  const dominantCount = topicCounts[dominantTopic] || 0;
  const sortedCounts = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1]);
  const runnerUpCount = sortedCounts[1]?.[1] || 0;

  return (
    totalTopicSamples >= 2 &&
    ratioOf(dominantCount, totalTopicSamples) >= MIN_TOPIC_MAJORITY_RATIO &&
    dominantCount > runnerUpCount
  );
}

function topKey(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
