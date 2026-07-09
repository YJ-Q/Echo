import { upsertUserProfile } from '../storage/memoryStore.js';
import { humanizeProfileValue } from './profileDictionary.js';
import { extractLearningTopic } from './topicExtractor.js';

export async function updateProfileFromInteraction(userInput, analysis) {
  const signals = extractProfileSignals(userInput, analysis);

  for (const signal of signals) {
    await upsertUserProfile(signal.key, signal.value, signal.confidence);
  }

  return signals;
}

export function extractProfileSignals(userInput, analysis) {
  const signals = [];
  const language = detectLanguage(userInput);
  const text = userInput.toLowerCase();

  signals.push({
    key: 'preferred_language',
    value: language,
    confidence: 0.7
  });

  if (analysis.intent === 'learning') {
    const topic = extractLearningTopic(userInput);

    if (topic) {
      signals.push({
        key: 'current_learning_focus',
        value: topic,
        confidence: 0.6
      });
    }

    signals.push({
      key: 'learning_preference',
      value: 'small executable steps',
      confidence: 0.58
    });
  }

  if (analysis.tags?.includes('procrastination')) {
    signals.push({
      key: 'recurring_pattern',
      value: 'procrastination around starting tasks',
      confidence: 0.6
    });

    signals.push({
      key: 'start_friction',
      value: 'difficulty entering the first action',
      confidence: 0.62
    });
  }

  if (analysis.tags?.includes('study') || analysis.tags?.includes('learning')) {
    signals.push({
      key: 'active_growth_area',
      value: 'learning and study execution',
      confidence: 0.55
    });
  }

  if (analysis.emotion === 'anxious' || containsAny(text, ['焦虑', '压力', '担心', '慌', 'worried', 'stress'])) {
    signals.push({
      key: 'emotional_trigger',
      value: 'future pressure entering the present',
      confidence: 0.56
    });
  }

  if (containsAny(text, ['5分钟', '十分钟', '10分钟', '一点点', '小步', 'small', 'tiny'])) {
    signals.push({
      key: 'execution_style',
      value: 'responds to small starts',
      confidence: 0.58
    });
  }

  if (analysis.intent === 'planning') {
    signals.push({
      key: 'planning_style',
      value: 'needs one main task and a stop point',
      confidence: 0.54
    });
  }

  signals.push({
    key: 'echo_interaction_style',
    value: 'reflective we-perspective with one next action',
    confidence: 0.52
  });

  return signals;
}

export function summarizeProfile(profileEntries = []) {
  const profile = Object.fromEntries(profileEntries.map((entry) => [entry.key, entry]));
  const stableSignals = profileEntries
    .filter((entry) => entry.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence);
  const developingSignals = profileEntries
    .filter((entry) => entry.confidence < 0.6)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    preferred_language: profile.preferred_language?.value || 'unknown',
    current_learning_focus: profile.current_learning_focus?.value || '',
    active_growth_area: profile.active_growth_area?.value || '',
    recurring_pattern: humanizeProfileValue(profile.recurring_pattern?.value || ''),
    start_friction: humanizeProfileValue(profile.start_friction?.value || ''),
    emotional_trigger: humanizeProfileValue(profile.emotional_trigger?.value || ''),
    emotional_baseline: humanizeProfileValue(profile.emotional_baseline?.value || ''),
    learning_preference: humanizeProfileValue(profile.learning_preference?.value || ''),
    execution_style: humanizeProfileValue(profile.execution_style?.value || ''),
    planning_style: humanizeProfileValue(profile.planning_style?.value || ''),
    recovery_path: humanizeProfileValue(profile.recovery_path?.value || ''),
    self_regulation_pattern: humanizeProfileValue(profile.self_regulation_pattern?.value || ''),
    sustained_learning_topic: profile.sustained_learning_topic?.value || '',
    echo_interaction_style: humanizeProfileValue(profile.echo_interaction_style?.value || ''),
    stable_signals: stableSignals.map(formatProfileSignal),
    developing_signals: developingSignals.map(formatProfileSignal),
    long_term_notes: buildLongTermNotes(profile),
    profile_note: buildProfileNote(profile)
  };
}

function detectLanguage(input) {
  return /[\u4e00-\u9fff]/.test(input) ? 'zh-CN' : 'en';
}

function containsAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function buildProfileNote(profile) {
  const notes = [];

  if (profile.current_learning_focus?.value) {
    notes.push(`当前学习主线是“${profile.current_learning_focus.value}”。`);
  }

  if (profile.recurring_pattern?.confidence >= 0.6) {
    notes.push(`较稳定的反复模式是“${humanizeProfileValue(profile.recurring_pattern.value)}”。`);
  }

  if (profile.start_friction?.confidence >= 0.6) {
    notes.push(`启动阻力多发生在“${humanizeProfileValue(profile.start_friction.value)}”。`);
  }

  if (profile.learning_preference?.value) {
    notes.push(`更适合用“${humanizeProfileValue(profile.learning_preference.value)}”推进。`);
  }

  if (!notes.length) {
    return '画像还在形成，我们先不急着定义自己。';
  }

  return notes.join(' ');
}

function buildLongTermNotes(profile) {
  const notes = [];

  if (profile.self_regulation_pattern?.value) {
    notes.push(humanizeProfileValue(profile.self_regulation_pattern.value));
  }

  if (profile.recovery_path?.value) {
    notes.push(`比较有效的回路是：${humanizeProfileValue(profile.recovery_path.value)}。`);
  }

  if (profile.emotional_baseline?.value) {
    notes.push(`最近的情绪底色更接近“${humanizeProfileValue(profile.emotional_baseline.value)}”。`);
  }

  if (profile.sustained_learning_topic?.value) {
    notes.push(`一条持续出现的学习线是“${profile.sustained_learning_topic.value}”。`);
  }

  return notes;
}

function formatProfileSignal(entry) {
  return {
    key: entry.key,
    value: humanizeProfileValue(entry.value),
    confidence: entry.confidence,
    updated_at: entry.updated_at
  };
}
