import { extractLearningTopic } from './topicExtractor.js';
import { buildEchoSystemPrompt, formatEchoReply } from './toneProfile.js';

export async function generateEchoResponse({
  userInput,
  analysis,
  memoryContext,
  learningSession
}) {
  const rawReply = process.env.OPENAI_API_KEY
    ? await generateWithOpenAI({ userInput, analysis, memoryContext, learningSession })
    : generateLocalEchoResponse({ userInput, analysis, memoryContext, learningSession });

  return formatEchoReply(rawReply);
}

function generateLocalEchoResponse({ userInput, analysis, memoryContext, learningSession }) {
  const context = getContextSignals(memoryContext);

  if (analysis.intent === 'learning') {
    return buildLearningReply(userInput, learningSession, context);
  }

  if (learningSession?.type === 'progress') {
    return buildLearningProgressReply(learningSession, context);
  }

  if (analysis.intent === 'struggle') {
    return compactLines([
      '我们不是完全不想做。',
      context.recurringPattern
        ? `这次又碰到那个旧模式：${context.recurringPattern}。`
        : '我们是在想开始和害怕开始之间来回拉扯。',
      '',
      context.learningFocus
        ? `别换战场。就回到“${context.learningFocus}”里的一个小入口。`
        : '先把任务缩小到不能再逃：只做 5 分钟。不是证明自己，只是进入现场。'
    ]);
  }

  if (analysis.intent === 'planning') {
    return compactLines([
      '先别安排太满。',
      context.hasProcrastinationPattern
        ? '我们有时会把计划做得很完整，用来延后真正开始。'
        : '真正重要的不是清单长度，是今天哪一件事会改变惯性。',
      '',
      '我们只选一个主任务，一个保底动作，一个停止时间。'
    ]);
  }

  if (analysis.emotion === 'anxious') {
    return compactLines([
      '我们现在像是在提前承受还没发生的事。',
      context.contextNote
        ? `但记忆里更清楚的是：${context.contextNote}`
        : '先把问题放回眼前：此刻能做的下一步是什么？',
      '',
      '先只问一个问题：现在能放下哪一层想象？'
    ]);
  }

  return compactLines([
    '我们听见了自己这句话。',
    context.contextNote
      ? `这句话和之前的回声连在一起：${context.contextNote}`
      : '这句话背后像是有一个更深的东西还没说完。',
    '',
    context.hasStableMemory ? '我们先看清它，不急着把它整理成答案。' : '继续说，不用整理得太像答案。'
  ]);
}

async function generateWithOpenAI({ userInput, analysis, memoryContext, learningSession }) {
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: buildEchoSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          current_input: userInput,
          analysis,
          memory_context: memoryContext,
          learning_session: learningSession
        })
      }
    ],
    temperature: 0.7
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed: ${detail}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || generateLocalEchoResponse({
    userInput,
    analysis,
    memoryContext,
    learningSession
  });
}

function buildLearningReply(userInput, learningSession, context = {}) {
  const topic = learningSession?.session?.topic || extractLearningTopic(userInput);
  const session = learningSession?.session;
  const currentStep = session?.steps?.[session.current_step];
  const prefix = learningSession?.created
    ? `好。我们先把“${topic}”变成一条能走的小路。`
    : `“${topic}”这条线已经在了。我们接着走，不重新开局。`;

  if (!currentStep) {
    return [
      prefix,
      '',
      '现在只做第一件事：用一句话说清它到底解决什么问题。'
    ].join('\n');
  }

  return compactLines([
    prefix,
    buildLearningContextLine(topic, context),
    '',
    `当前这一小步：${currentStep.title}`,
    currentStep.action,
    '',
    '做完后，把结果丢回来。先让它发生，不急着完整。'
  ]);
}

function buildLearningProgressReply(learningSession, context = {}) {
  if (learningSession.status === 'complete') {
    const session = learningSession.session;

    if (session.status === 'completed') {
      return [
        '好，这一轮走完了。',
        `我们没有只是“学了点 ${session.topic}”，我们完成了一次从开始到收束的循环。`,
        '',
        '先停一下。用一句话写下：这轮最有用的东西是什么？'
      ].join('\n');
    }

    const nextStep = session.steps[session.current_step];

    return compactLines([
      '好，往前推了一格。',
      context.hasProcrastinationPattern ? '注意，我们没有靠情绪变好才开始，而是靠动作把路踩出来。' : null,
      `下一步：${nextStep.title}`,
      nextStep.action,
      '',
      '别重新计划。我们接着做这一小块。'
    ]);
  }

  if (learningSession.status === 'stuck') {
    const step = learningSession.current_step;

    return compactLines([
      '卡住是信息，不是失败。',
      `我们现在卡在：${step.title}`,
      context.recurringPattern ? `这也像那个旧模式：${context.recurringPattern}。` : null,
      '',
      '把它再拆小：',
      '1. 哪个词不懂？',
      '2. 哪一步复现不了？',
      '3. 我们以为它应该怎样，但现实怎样？',
      '',
      '只回答其中一个。'
    ]);
  }

  if (learningSession.status === 'partial') {
    const step = learningSession.current_step;

    return compactLines([
      '这已经不是空想了。',
      `先把它对准当前这一小步：${step.title}`,
      context.learningFocus ? `这条线还是“${context.learningFocus}”，不用换题。` : null,
      '',
      '如果这一步完成了，就直接说“完成”。',
      '如果还没完成，就补一句最具体的卡点。'
    ]);
  }

  return '';
}

function buildMemoryHint(memoryContext) {
  if (!Array.isArray(memoryContext) && hasStableContext(memoryContext.summary)) {
    return `我们也记得：${memoryContext.summary.context_note} 这次先不要急着换方向。`;
  }

  const memories = Array.isArray(memoryContext)
    ? memoryContext
    : memoryContext.relevantMemories || memoryContext.recentMemories || [];

  if (!memories.length) {
    return '';
  }

  const statePattern = !Array.isArray(memoryContext)
    ? memoryContext.userStates?.find((state) => state.key.startsWith('tag:'))?.value
    : '';
  const learningFocus = !Array.isArray(memoryContext)
    ? memoryContext.userProfile?.find((profile) => profile.key === 'current_learning_focus')?.value
    : '';

  const recentPattern = statePattern || memories
    .flatMap((memory) => memory.tags || [])
    .find((tag) => tag === 'procrastination' || tag === 'learning' || tag === 'study');

  if (learningFocus && recentPattern) {
    return `我们也记得，最近一边靠近“${learningFocus}”，一边反复遇到“${recentPattern}”。先看清这个循环。`;
  }

  if (!recentPattern) {
    return '';
  }

  return `我们也记得，最近“${recentPattern}”反复出现过。先别急着评价它，观察它。`;
}

function buildLearningContextLine(topic, context) {
  if (!context.hasStableMemory) {
    return null;
  }

  if (context.learningFocus && context.learningFocus !== topic) {
    return `记忆里上一条学习线是“${context.learningFocus}”。这次我们先确认：是继续，还是切到“${topic}”。`;
  }

  if (context.hasProcrastinationPattern) {
    return '真正要处理的可能不是内容难，而是开始前那一下卡住。';
  }

  return null;
}

function getContextSignals(memoryContext) {
  const summary = Array.isArray(memoryContext) ? null : memoryContext?.summary;
  const repeatedTags = summary?.repeated_tags || [];
  const recurringPattern = humanizePattern(summary?.recurring_pattern || '');
  const contextNote = hasStableContext(summary) ? summary.context_note : '';

  return {
    contextNote,
    learningFocus: summary?.current_learning_focus || '',
    recurringPattern,
    repeatedTags,
    hasStableMemory: hasStableContext(summary),
    hasProcrastinationPattern: recurringPattern.includes('拖延')
      || repeatedTags.some((entry) => entry.tag === 'procrastination')
  };
}

function hasStableContext(summary) {
  return Boolean(summary?.context_note)
    && summary.context_note !== '还没有足够的记忆形成稳定模式。';
}

function humanizePattern(value) {
  const patterns = {
    'procrastination around starting tasks': '启动任务前的拖延'
  };

  return patterns[value] || value;
}

function compactLines(lines) {
  return lines.filter((line) => line !== null && line !== undefined).join('\n');
}
