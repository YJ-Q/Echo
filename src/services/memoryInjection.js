export function buildMemoryInjection({
  summary = {},
  relevantMemories = [],
  recentMemories = [],
  userStates = [],
  userProfile = [],
  pendingActions = [],
  recentSummaries = []
}) {
  const profileMap = Object.fromEntries(userProfile.map((entry) => [entry.key, entry.value]));
  const recentAction = pendingActions[0] || null;
  const latestReflection = recentSummaries[0] || null;
  const lastEmotionState = userStates.find((state) => state.key === 'last_emotion')?.value || 'neutral';

  const layers = {
    emotional: {
      current_emotion: summary.dominant_emotion || lastEmotionState || 'neutral',
      emotional_trend: summarizeEmotionTrend(recentMemories),
      note: buildEmotionalNote(summary, recentMemories)
    },
    pattern: {
      recurring_pattern: summary.recurring_pattern || profileMap.recurring_pattern || '',
      repeated_tags: summary.repeated_tags || [],
      note: buildPatternNote(summary)
    },
    learning: {
      focus: summary.current_learning_focus || profileMap.current_learning_focus || '',
      preference: profileMap.learning_preference || '',
      note: buildLearningNote(summary, profileMap)
    },
    action: {
      pending_action: recentAction
        ? {
            type: recentAction.type,
            title: recentAction.title,
            detail: recentAction.detail,
            source: recentAction.source
          }
        : null,
      note: buildActionNote(recentAction)
    },
    reflection: {
      latest_reflection: latestReflection?.echo_reflection || '',
      behavioral_pattern: latestReflection?.behavioral_pattern || '',
      note: latestReflection ? '最近已经有一条可回看的回声。' : ''
    },
    conversation: {
      relevant_memories: relevantMemories.slice(0, 5).map(toMemorySnippet),
      recent_memories: recentMemories.slice(0, 3).map(toMemorySnippet),
      note: buildConversationNote(relevantMemories, recentMemories)
    }
  };

  return {
    layers,
    prompt_context: buildPromptContext(layers)
  };
}

function toMemorySnippet(memory) {
  return {
    timestamp: memory.timestamp,
    user_input: memory.user_input,
    emotion: memory.emotion,
    tags: memory.tags,
    memory_note: memory.memory_note || '',
    insight_note: memory.insight_note || '',
    salience: memory.salience ?? 0.5,
    reinforcement_count: memory.reinforcement_count ?? 1,
    priority_bucket: memory.priority_bucket || 'ambient'
  };
}

function summarizeEmotionTrend(memories) {
  const emotions = memories.map((memory) => memory.emotion).filter(Boolean);

  if (emotions.length === 0) {
    return 'still_forming';
  }

  const recent = emotions.slice(0, 3);

  if (recent.every((emotion) => emotion === 'anxious')) {
    return 'sustained_anxious';
  }

  if (recent.includes('distracted') && recent.includes('motivated')) {
    return 'friction_with_motion';
  }

  if (recent.includes('focused')) {
    return 'returning_to_focus';
  }

  return recent[0] || 'neutral';
}

function buildEmotionalNote(summary, recentMemories) {
  if (summary.context_note && summary.dominant_emotion !== 'neutral') {
    return `当前情绪底色更接近“${humanizeEmotion(summary.dominant_emotion)}”。`;
  }

  if (recentMemories.length > 0) {
    return '最近几次对话已经带出了一些情绪轨迹。';
  }

  return '';
}

function buildPatternNote(summary) {
  if (summary.recurring_pattern) {
    return `反复出现的模式是“${humanizePattern(summary.recurring_pattern)}”。`;
  }

  if ((summary.repeated_tags || []).length > 0) {
    return '有一些重复标签开始形成轮廓。';
  }

  return '';
}

function buildLearningNote(summary, profileMap) {
  const focus = summary.current_learning_focus || profileMap.current_learning_focus;

  if (focus) {
    return `当前学习主线仍然是“${focus}”。`;
  }

  if (profileMap.learning_preference) {
    return '更适合沿着小步可执行的方式推进。';
  }

  return '';
}

function buildActionNote(action) {
  if (!action) {
    return '';
  }

  return `还有一个未完成动作留在队列里：“${action.title}”。`;
}

function buildConversationNote(relevantMemories, recentMemories) {
  if (relevantMemories.length > 0) {
    return '这次输入和过去几段回声是连着的。';
  }

  if (recentMemories.length > 0) {
    return '虽然没有直接命中旧话题，但最近的状态仍然有参考价值。';
  }

  return '记忆还在形成初始轮廓。';
}

function buildPromptContext(layers) {
  return [
    layers.emotional.note,
    layers.pattern.note,
    layers.learning.note,
    layers.action.note,
    layers.reflection.note,
    layers.conversation.note
  ].filter(Boolean).join(' ');
}

function humanizePattern(value) {
  const patterns = {
    'procrastination around starting tasks': '启动任务前的拖延'
  };

  return patterns[value] || value;
}

function humanizeEmotion(value) {
  const emotions = {
    focused: '专注',
    distracted: '分心',
    anxious: '焦虑',
    neutral: '平静',
    motivated: '有动力'
  };

  return emotions[value] || value;
}
