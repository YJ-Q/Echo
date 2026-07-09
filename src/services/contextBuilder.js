import {
  getActions,
  getMemories,
  getRelevantMemories,
  getSummaries,
  getUserProfile,
  getUserStates
} from '../storage/memoryStore.js';
import { analyzeInput } from './inputAnalyzer.js';
import { buildMemoryInjection } from './memoryInjection.js';
import { summarizeProfile } from './profileEngine.js';

export async function buildContext(userInput) {
  const queryAnalysis = analyzeInput(userInput || '');
  const [relevantMemories, recentMemories, userStates, userProfile, pendingActions, recentSummaries] = await Promise.all([
    getRelevantMemories(userInput, { limit: 8 }),
    getMemories({ limit: 6 }),
    getUserStates({ limit: 12 }),
    getUserProfile(),
    getActions({ status: 'pending', limit: 3 }),
    getSummaries({ limit: 2 })
  ]);
  const explainedRelevantMemories = relevantMemories.map(addRetrievalExplanation);

  const summary = summarizeContext({
    relevantMemories: explainedRelevantMemories,
    recentMemories,
    userStates,
    userProfile,
    queryAnalysis
  });
  const injection = buildMemoryInjection({
    summary,
    relevantMemories: explainedRelevantMemories,
    recentMemories,
    userStates,
    userProfile,
    pendingActions,
    recentSummaries
  });

  return {
    relevantMemories: explainedRelevantMemories,
    recentMemories,
    userStates,
    userProfile,
    pendingActions,
    recentSummaries,
    summary,
    injection
  };
}

export function summarizeContext({
  relevantMemories = [],
  recentMemories = [],
  userStates = [],
  userProfile = [],
  queryAnalysis = null
} = {}) {
  const memoryPool = mergeMemories(relevantMemories, recentMemories);
  const hasMemory = memoryPool.length > 0;
  const emotionCounts = countBy(memoryPool.map((memory) => memory.emotion));
  const tagCounts = countBy(memoryPool.flatMap((memory) => memory.tags || []));
  const profile = Object.fromEntries(userProfile.map((entry) => [entry.key, entry.value]));
  const profileSummary = summarizeProfile(userProfile);
  const profileNote = isDevelopingProfileNote(profileSummary.profile_note)
    ? ''
    : profileSummary.profile_note;
  const repeatedTags = Object.entries(tagCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
  const dominantEmotion = topKey(emotionCounts)
    || userStates.find((state) => state.key === 'last_emotion')?.value
    || 'neutral';
  const dominantTag = pickDominantTag(tagCounts);
  const latestMemory = recentMemories[0] || null;
  const currentLearningFocus = profile.current_learning_focus || '';
  const recurringPattern = profile.recurring_pattern || repeatedTags[0]?.tag || '';
  const insightTrail = mergeInsightTrail(memoryPool);
  const priorityOverview = buildPriorityOverview(memoryPool);
  const retrievalOverview = buildRetrievalOverview(relevantMemories);
  const memoryLayers = buildMemoryLayers({
    relevantMemories,
    recentMemories
  });

  return {
    dominant_emotion: dominantEmotion,
    dominant_tag: dominantTag,
    repeated_tags: repeatedTags,
    current_learning_focus: currentLearningFocus,
    recurring_pattern: recurringPattern,
    profile_note: profileNote,
    latest_user_input: latestMemory?.user_input || '',
    latest_memory_note: latestMemory?.memory_note || '',
    insight_trail: insightTrail,
    priority_overview: priorityOverview,
    memory_layers: memoryLayers,
    retrieval_overview: retrievalOverview,
    recall_channels: retrievalOverview.channels,
    query_intent: queryAnalysis?.intent || 'chat',
    query_emotion: queryAnalysis?.emotion || 'neutral',
    context_note: buildContextNote({
      hasMemory,
      profileNote,
      dominantEmotion,
      dominantTag,
      repeatedTags,
      currentLearningFocus,
      recurringPattern,
      latestMemory,
      insightTrail,
      priorityOverview,
      retrievalOverview
    })
  };
}

function buildContextNote({
  hasMemory,
  profileNote,
  currentLearningFocus,
  recurringPattern,
  latestMemory,
  insightTrail,
  priorityOverview,
  retrievalOverview,
  repeatedTags,
  dominantEmotion,
  dominantTag
}) {
  const notes = [];

  if (!hasMemory && !currentLearningFocus && !recurringPattern && !profileNote) {
    return '还没有足够的记忆形成稳定模式。';
  }

  if (!hasMemory && profileNote) {
    notes.push(profileNote);
  }

  if (currentLearningFocus) {
    notes.push(`最近的学习主线是“${currentLearningFocus}”。`);
  }

  if (recurringPattern) {
    notes.push(`一个反复出现的模式是“${formatPattern(recurringPattern)}”。`);
  }

  if (latestMemory?.memory_note) {
    notes.push(`最近一次内部笔记是：${latestMemory.memory_note}`);
  }

  if (insightTrail.length > 0) {
    notes.push(`最近保留下来的一条洞察是：${insightTrail[0]}`);
  }

  if (priorityOverview.core.length > 0) {
    notes.push(`目前更常驻的记忆锚点有：${priorityOverview.core.join('、')}。`);
  }

  if (retrievalOverview.summary) {
    notes.push(retrievalOverview.summary);
  }

  if (repeatedTags.length > 0) {
    notes.push(`重复标签：${repeatedTags.map((entry) => `${formatTag(entry.tag)}x${entry.count}`).join('、')}。`);
  }

  if (dominantEmotion && dominantEmotion !== 'neutral') {
    notes.push(`近期情绪更接近“${formatEmotion(dominantEmotion)}”。`);
  }

  if (!notes.length && dominantTag) {
    notes.push(`最近的对话还在围绕“${formatTag(dominantTag)}”形成轮廓。`);
  }

  return notes.join(' ');
}

function mergeMemories(...groups) {
  const seen = new Set();
  const merged = [];

  for (const group of groups) {
    for (const memory of group || []) {
      const key = memory.id || `${memory.timestamp}:${memory.user_input}`;

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(memory);
      }
    }
  }

  return merged;
}

function mergeInsightTrail(memories) {
  return memories
    .map((memory) => memory.insight_note)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 3);
}

function buildPriorityOverview(memories) {
  const core = [];
  const important = [];

  for (const memory of memories) {
    const label = memory.memory_note || memory.user_input;

    if (!label) {
      continue;
    }

    if (memory.priority_bucket === 'core' && core.length < 3) {
      core.push(trimLabel(label));
    } else if (memory.priority_bucket === 'important' && important.length < 3) {
      important.push(trimLabel(label));
    }
  }

  return { core, important };
}

function buildMemoryLayers({
  relevantMemories = [],
  recentMemories = []
}) {
  const core = [];
  const working = [];
  const recent = [];
  const ambient = [];
  const coreKeys = new Set();
  const workingKeys = new Set();
  const recentKeys = new Set();
  const workingChannels = new Set(['direct_match', 'learning_continuity']);
  const rankedRelevant = [...relevantMemories].sort((left, right) => {
    const leftScore = Number(left.retrieval?.ranking_score ?? left.retrieval?.score ?? 0);
    const rightScore = Number(right.retrieval?.ranking_score ?? right.retrieval?.score ?? 0);

    return rightScore - leftScore;
  });

  for (const memory of mergeMemories(relevantMemories, recentMemories)) {
    if (isCoreMemory(memory)) {
      const key = getMemoryKey(memory);

      core.push(toLayerMemory(memory, 'core'));
      coreKeys.add(key);
    }
  }

  for (const memory of rankedRelevant) {
    const key = getMemoryKey(memory);
    const channels = memory.retrieval?.channels || [];
    const rankingScore = Number(memory.retrieval?.ranking_score ?? memory.retrieval?.score ?? 0);
    const qualifies = channels.some((channel) => workingChannels.has(channel))
      || rankingScore >= 0.7
      || working.length < 2;

    if (!workingKeys.has(key) && qualifies) {
      working.push(toLayerMemory(memory, 'working'));
      workingKeys.add(key);
    }
  }

  for (const memory of recentMemories) {
    const key = getMemoryKey(memory);

    if (!coreKeys.has(key) && !workingKeys.has(key) && !recentKeys.has(key)) {
      recent.push(toLayerMemory(memory, 'recent'));
      recentKeys.add(key);
    }
  }

  for (const memory of mergeMemories(relevantMemories, recentMemories)) {
    const key = getMemoryKey(memory);

    if (!coreKeys.has(key) && !workingKeys.has(key) && !recentKeys.has(key)) {
      ambient.push(toLayerMemory(memory, 'ambient'));
    }
  }

  return { core, working, recent, ambient };
}

function buildRetrievalOverview(memories) {
  const channelCounts = countBy(memories.flatMap((memory) => memory.retrieval?.channels || []));
  const channels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([channel, count]) => ({
      channel,
      count,
      label: humanizeRecallChannel(channel),
      reason: describeRecallChannel(channel)
    }));
  const rankingScores = memories
    .map((memory) => normalizeScore(memory.retrieval?.ranking_score ?? memory.retrieval?.score))
    .filter((score) => score !== null);
  const channelScores = memories
    .map((memory) => normalizeScore(memory.retrieval?.channel_score))
    .filter((score) => score !== null);

  return {
    total_memories: memories.length,
    channels,
    strongest_channel: channels[0] || null,
    score_range: buildScoreRange(rankingScores),
    average_channel_score: averageScore(channelScores),
    summary: buildRetrievalSummary(channels)
  };
}

function buildRetrievalSummary(channels) {
  if (channels.length === 0) {
    return '';
  }

  const labels = channels
    .slice(0, 2)
    .map(({ channel }) => humanizeRecallChannel(channel))
    .join('、');

  return `这次被唤起的记忆，主要来自${labels}。`;
}

function addRetrievalExplanation(memory) {
  const retrieval = memory.retrieval || {};
  const channels = (retrieval.channels || []).map((channel) => ({
    channel,
    label: humanizeRecallChannel(channel),
    reason: describeRecallChannel(channel)
  }));
  const rankingScore = normalizeScore(retrieval.ranking_score ?? retrieval.score);
  const channelScore = normalizeScore(retrieval.channel_score);
  const score = normalizeScore(retrieval.score ?? retrieval.ranking_score);

  return {
    ...memory,
    retrieval: {
      ...retrieval,
      explanation: {
        summary: buildMemoryRetrievalSummary(channels, {
          rankingScore,
          channelScore
        }),
        primary_channel: channels[0]?.channel || '',
        primary_label: channels[0]?.label || '',
        channels,
        scores: {
          score,
          ranking_score: rankingScore,
          channel_score: channelScore
        }
      }
    }
  };
}

function buildMemoryRetrievalSummary(channels, { rankingScore, channelScore }) {
  if (channels.length === 0) {
    return '这条记忆被召回，但没有明确的召回通道。';
  }

  const labels = channels
    .slice(0, 2)
    .map((channel) => channel.label)
    .join('、');
  const scoreParts = [];

  if (rankingScore !== null) {
    scoreParts.push(`排序分 ${rankingScore}`);
  }

  if (channelScore !== null) {
    scoreParts.push(`通道分 ${channelScore}`);
  }

  return scoreParts.length > 0
    ? `这条记忆主要通过${labels}被召回（${scoreParts.join('，')}）。`
    : `这条记忆主要通过${labels}被召回。`;
}

function describeRecallChannel(value) {
  const reasons = {
    direct_match: '记忆文本或主题与当前问题直接重合。',
    learning_continuity: '记忆延续了当前或反复出现的学习主题。',
    emotional_resonance: '记忆带有相近的情绪信号或模式标签。',
    core_anchor: '记忆被置顶、归入核心，或具有较高优先级。',
    recent_thread: '记忆足够近期，可维持当前对话连续性。'
  };

  return reasons[value] || '这条记忆命中了某个召回信号。';
}

function normalizeScore(value) {
  const number = Number(value);

  return Number.isFinite(number) ? Number(number.toFixed(3)) : null;
}

function buildScoreRange(scores) {
  if (scores.length === 0) {
    return {
      min: null,
      max: null
    };
  }

  return {
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

function averageScore(scores) {
  if (scores.length === 0) {
    return null;
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return Number((total / scores.length).toFixed(3));
}

function trimLabel(value) {
  return value.length <= 30 ? value : `${value.slice(0, 30)}...`;
}

function toLayerMemory(memory, layer) {
  return {
    id: memory.id,
    layer,
    timestamp: memory.timestamp,
    label: trimLabel(memory.memory_note || memory.user_input || ''),
    user_input: memory.user_input || '',
    memory_note: memory.memory_note || '',
    priority_bucket: memory.priority_bucket || 'ambient',
    pinned: Boolean(memory.pinned),
    salience: memory.salience ?? 0.5,
    reinforcement_count: memory.reinforcement_count ?? 1,
    retrieval_channels: memory.retrieval?.channels || [],
    retrieval_score: normalizeScore(memory.retrieval?.ranking_score ?? memory.retrieval?.score)
  };
}

function isCoreMemory(memory) {
  return Boolean(memory?.pinned) || memory?.priority_bucket === 'core';
}

function getMemoryKey(memory) {
  return memory.id || `${memory.timestamp}:${memory.user_input}`;
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
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function pickDominantTag(tagCounts) {
  const meaningfulTag = Object.entries(tagCounts)
    .filter(([tag]) => tag !== 'life')
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return meaningfulTag || topKey(tagCounts) || 'life';
}

function isDevelopingProfileNote(note) {
  return !note || note === '画像还在形成，我们先不急着定义自己。';
}

function formatPattern(value) {
  const patterns = {
    'procrastination around starting tasks': '启动任务前的拖延'
  };

  return patterns[value] || formatTag(value);
}

function formatTag(value) {
  const tags = {
    learning: '学习',
    procrastination: '拖延',
    planning: '计划',
    study: '学习执行',
    mood: '情绪',
    life: '生活'
  };

  return tags[value] || value;
}

function formatEmotion(value) {
  const emotions = {
    focused: '专注',
    distracted: '分心',
    anxious: '焦虑',
    neutral: '平静',
    motivated: '有动力'
  };

  return emotions[value] || value;
}

function humanizeRecallChannel(value) {
  const labels = {
    direct_match: '当前话题直接命中',
    learning_continuity: '学习主线延续',
    emotional_resonance: '情绪与模式共振',
    core_anchor: '长期核心锚点',
    recent_thread: '最近对话线程'
  };

  return labels[value] || value;
}
