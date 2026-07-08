import { getLearningEvents, getMemories, saveSummary } from '../storage/memoryStore.js';

export async function generateDailySummary(date = new Date()) {
  const memories = await getMemories();
  const learningEvents = await getLearningEvents({ limit: 200 });
  const dayKey = toDateKey(date);
  const today = memories.filter((memory) => toDateKey(new Date(memory.timestamp)) === dayKey);
  const todayLearningEvents = learningEvents.filter((event) => {
    return toDateKey(new Date(event.created_at)) === dayKey;
  });

  if (today.length === 0 && todayLearningEvents.length === 0) {
    return saveSummary({
      date: dayKey,
      summary: '今天还没有留下足够的回声。',
      emotional_trend: 'neutral',
      behavioral_pattern: '还没有足够记录形成模式。',
      echo_reflection: '空白不是失败，只是还没有被看见。'
    });
  }

  const emotionCounts = countBy(today.map((memory) => memory.emotion));
  const tagCounts = countBy(today.flatMap((memory) => memory.tags || []));
  const eventCounts = countBy(todayLearningEvents.map((event) => event.event_type));
  const dominantEmotion = topKey(emotionCounts) || 'neutral';
  const dominantTag = pickDominantTag(tagCounts, todayLearningEvents);
  const facts = buildDayFacts({
    memories: today,
    learningEvents: todayLearningEvents,
    emotionCounts,
    tagCounts,
    eventCounts,
    dominantEmotion,
    dominantTag
  });
  const pattern = detectPattern(facts);

  return saveSummary({
    date: dayKey,
    summary: buildSummary(facts),
    emotional_trend: dominantEmotion,
    behavioral_pattern: pattern.description,
    echo_reflection: buildReflection(pattern, facts)
  });
}

function buildDayFacts({
  memories,
  learningEvents,
  emotionCounts,
  tagCounts,
  eventCounts,
  dominantEmotion,
  dominantTag
}) {
  const learningTopics = unique(learningEvents.map((event) => event.topic).filter(Boolean));
  const completedSteps = countEvents(learningEvents, ['step_completed', 'manual_step_done']);
  const stuckSteps = countEvents(learningEvents, ['step_stuck']);
  const attemptedSteps = countEvents(learningEvents, ['step_attempted']);
  const createdSessions = countEvents(learningEvents, ['session_created']);
  const planningMentions = tagCounts.planning || 0;
  const procrastinationMentions = tagCounts.procrastination || 0;
  const learningMentions = tagCounts.learning || 0;
  const anxietyMentions = emotionCounts.anxious || 0;

  return {
    memories,
    learningEvents,
    emotionCounts,
    tagCounts,
    eventCounts,
    dominantEmotion,
    dominantTag,
    learningTopics,
    completedSteps,
    stuckSteps,
    attemptedSteps,
    createdSessions,
    planningMentions,
    procrastinationMentions,
    learningMentions,
    anxietyMentions,
    hadLearningIntent: learningMentions > 0 || createdSessions > 0,
    hadLearningAction: completedSteps > 0 || attemptedSteps > 0 || stuckSteps > 0,
    hadCompletion: completedSteps > 0,
    hadStuckPoint: stuckSteps > 0,
    hadPlanningWithoutAction: planningMentions > 0 && completedSteps === 0 && attemptedSteps === 0,
    hadProcrastinationAtStart: procrastinationMentions > 0 && completedSteps === 0,
    hadFuturePressure: anxietyMentions > 0 || dominantEmotion === 'anxious',
    latestStuck: learningEvents.find((event) => event.event_type === 'step_stuck') || null,
    latestCompleted: learningEvents.find((event) => {
      return ['step_completed', 'manual_step_done'].includes(event.event_type);
    }) || null
  };
}

function buildSummary(facts) {
  const parts = [];

  const memorySummary = buildMemorySummary(facts);
  const learningSummary = buildLearningSummary(facts);
  const emotionSummary = buildEmotionSummary(facts);

  if (memorySummary) {
    parts.push(memorySummary);
  }

  if (learningSummary) {
    parts.push(learningSummary);
  }

  if (emotionSummary) {
    parts.push(emotionSummary);
  }

  return parts.join(' ');
}

function buildMemorySummary(facts) {
  if (facts.memories.length === 0) {
    return '';
  }

  if (facts.memories.length === 1) {
    return `今天的记录先落在了“${formatTag(facts.dominantTag)}”上。`;
  }

  return `今天的记录大多围着“${formatTag(facts.dominantTag)}”展开，一共留下了 ${facts.memories.length} 次对话。`;
}

function buildLearningSummary(facts) {
  if (facts.learningEvents.length === 0) {
    return '';
  }

  const topicText = facts.learningTopics.length ? facts.learningTopics.join('、') : '当前学习线';

  if (facts.hadCompletion && facts.hadStuckPoint) {
    return `围绕“${topicText}”一边推进，一边把卡点看清：完成了 ${facts.completedSteps} 步，也标出了 ${facts.stuckSteps} 处阻力。`;
  }

  if (facts.hadCompletion) {
    const attemptTail = facts.attemptedSteps > 0 ? '，中间也有继续试着往前推' : '';
    return `围绕“${topicText}”已经往前走了一段，完成了 ${facts.completedSteps} 步${attemptTail}。`;
  }

  if (facts.hadStuckPoint) {
    const attemptLead = facts.attemptedSteps > 0 ? '已经开始上手，' : '';
    return `围绕“${topicText}”${attemptLead}也碰到了 ${facts.stuckSteps} 个具体卡点。`;
  }

  if (facts.attemptedSteps > 0) {
    return `围绕“${topicText}”已经试着动手 ${facts.attemptedSteps} 次，节奏正在形成。`;
  }

  if (facts.createdSessions > 0) {
    return `“${topicText}”这条学习线今天被重新拉近，行动还停在起步处。`;
  }

  return `围绕“${topicText}”留下了一些学习痕迹，节奏还在形成。`;
}

function buildEmotionSummary(facts) {
  if (facts.dominantEmotion === 'neutral') {
    return '';
  }

  if (facts.dominantEmotion === 'anxious' && facts.learningEvents.length > 0) {
    return `情绪上更接近“${formatEmotion(facts.dominantEmotion)}”，但注意力还留在手头这条线上。`;
  }

  return `情绪上更接近“${formatEmotion(facts.dominantEmotion)}”。`;
}

function detectPattern(facts) {
  if (facts.hadStuckPoint && facts.hadCompletion) {
    return {
      id: 'friction_with_recovery',
      description: '我们遇到具体阻力，但没有离开学习线。'
    };
  }

  if (facts.hadStuckPoint) {
    return {
      id: 'specific_friction',
      description: '我们把模糊的困难推进成了一个具体卡点。'
    };
  }

  if (facts.hadLearningIntent && facts.hadCompletion) {
    return {
      id: 'learning_loop_closed',
      description: '我们把学习意图推进成了至少一个完成闭环。'
    };
  }

  if (facts.hadLearningIntent && !facts.hadLearningAction) {
    return {
      id: 'learning_without_execution',
      description: '我们多次靠近学习，但还没有形成可见行动。'
    };
  }

  if (facts.hadPlanningWithoutAction) {
    return {
      id: 'planning_without_action',
      description: '我们在计划层停留得比行动层更久。'
    };
  }

  if (facts.hadProcrastinationAtStart) {
    return {
      id: 'start_line_procrastination',
      description: '拖延主要出现在开始之前，而不是过程中。'
    };
  }

  if (facts.hadFuturePressure) {
    return {
      id: 'future_pressure',
      description: '未来压力提前进入了今天。'
    };
  }

  if (facts.dominantTag === 'learning') {
    return {
      id: 'learning_orientation',
      description: '我们在靠近成长，但还需要更小的执行闭环。'
    };
  }

  return {
    id: 'pattern_forming',
    description: '今天的模式还在形成，没有必要过早下结论。'
  };
}

function buildReflection(pattern, facts) {
  const topic = facts.learningTopics[0];

  const reflections = {
    friction_with_recovery: `我们今天不是没有被卡住，而是被卡住后还留在“${topic || '这条线'}”里。`,
    specific_friction: `我们今天把阻力看清了：它落在“${facts.latestStuck?.step_title || '某个具体步骤'}”，不是落在整个自己身上。`,
    learning_loop_closed: '我们今天至少完成了一个小闭环。它不大，但它是真实发生过的。',
    learning_without_execution: '我们今天反复靠近学习，但还没有真正进入现场。明天只需要守住第一个 5 分钟。',
    planning_without_action: '我们今天有一点把计划当成了行动的替身。下一次，先做一样，再整理全局。',
    start_line_procrastination: '我们今天不是没有方向，而是一直在入口处徘徊。入口还要继续缩小。',
    future_pressure: '我们今天承担了太多尚未发生的事。先把明天还给明天。',
    learning_orientation: '我们在靠近新的自己，但还需要把理解继续变成动作。',
    pattern_forming: '今天的我们还在成形，先别急着下结论。'
  };

  return reflections[pattern.id] || reflections.pattern_forming;
}

function countBy(items) {
  return items.reduce((counts, item) => {
    counts[item] = (counts[item] || 0) + 1;
    return counts;
  }, {});
}

function countEvents(events, eventTypes) {
  return events.filter((event) => eventTypes.includes(event.event_type)).length;
}

function unique(items) {
  return [...new Set(items)];
}

function topKey(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function pickDominantTag(tagCounts, learningEvents) {
  if (learningEvents.length > 0) {
    return 'learning';
  }

  const meaningfulTag = Object.entries(tagCounts)
    .filter(([tag]) => tag !== 'life')
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return meaningfulTag || topKey(tagCounts) || 'life';
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatTag(tag) {
  const tags = {
    learning: '学习',
    procrastination: '拖延',
    planning: '计划',
    study: '学习执行',
    mood: '情绪',
    life: '生活'
  };

  return tags[tag] || tag;
}

function formatEmotion(emotion) {
  const emotions = {
    focused: '专注',
    distracted: '分心',
    anxious: '焦虑',
    neutral: '平静',
    motivated: '有动力'
  };

  return emotions[emotion] || emotion;
}
