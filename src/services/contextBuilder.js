import {
  getMemories,
  getRelevantMemories,
  getUserProfile,
  getUserStates
} from '../storage/memoryStore.js';
import { summarizeProfile } from './profileEngine.js';

export async function buildContext(userInput) {
  const [relevantMemories, recentMemories, userStates, userProfile] = await Promise.all([
    getRelevantMemories(userInput, { limit: 8 }),
    getMemories({ limit: 6 }),
    getUserStates({ limit: 12 }),
    getUserProfile()
  ]);

  return {
    relevantMemories,
    recentMemories,
    userStates,
    userProfile,
    summary: summarizeContext({
      relevantMemories,
      recentMemories,
      userStates,
      userProfile
    })
  };
}

export function summarizeContext({
  relevantMemories = [],
  recentMemories = [],
  userStates = [],
  userProfile = []
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
  const dominantEmotion = topKey(emotionCounts) || userStates.find((state) => {
    return state.key === 'last_emotion';
  })?.value || 'neutral';
  const dominantTag = pickDominantTag(tagCounts);
  const latestMemory = recentMemories[0] || null;
  const currentLearningFocus = profile.current_learning_focus || '';
  const recurringPattern = profile.recurring_pattern || repeatedTags[0]?.tag || '';

  return {
    dominant_emotion: dominantEmotion,
    dominant_tag: dominantTag,
    repeated_tags: repeatedTags,
    current_learning_focus: currentLearningFocus,
    recurring_pattern: recurringPattern,
    profile_note: profileNote,
    latest_user_input: latestMemory?.user_input || '',
    context_note: buildContextNote({
      hasMemory,
      profileNote,
      dominantEmotion,
      dominantTag,
      repeatedTags,
      currentLearningFocus,
      recurringPattern
    })
  };
}

function buildContextNote({
  hasMemory,
  profileNote,
  dominantEmotion,
  dominantTag,
  repeatedTags,
  currentLearningFocus,
  recurringPattern
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

  if (repeatedTags.length > 0) {
    notes.push(`重复标签：${repeatedTags.map((entry) => {
      return `${formatTag(entry.tag)}×${entry.count}`;
    }).join('、')}。`);
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
    motivated: '有动机'
  };

  return emotions[value] || value;
}
