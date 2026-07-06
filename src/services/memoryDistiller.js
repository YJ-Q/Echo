export function distillInteractionMemory({
  userInput,
  reply,
  analysis,
  learningSession,
  behaviorHint
}) {
  const memoryNote = buildMemoryNote({
    userInput,
    analysis,
    learningSession
  });
  const insightNote = buildInsightNote({
    analysis,
    learningSession,
    behaviorHint
  });

  return {
    memory_note: memoryNote,
    insight_note: insightNote
  };
}

function buildMemoryNote({ userInput, analysis, learningSession }) {
  const shortInput = summarizeUserInput(userInput);

  if (analysis.intent === 'learning') {
    const topic = learningSession?.session?.topic || shortInput;
    return `我们把注意力放回了“${topic}”，想把学习变成能执行的一小步。`;
  }

  if (analysis.intent === 'struggle') {
    return `我们提到了开始前的拉扯，阻力更像出现在行动入口。`;
  }

  if (analysis.intent === 'planning') {
    return `我们在试着整理下一步，但真正重要的是把计划压到可以开始。`;
  }

  if (analysis.emotion === 'anxious') {
    return `我们说到了焦虑，像是在提前承受还没发生的事。`;
  }

  return `我们留下了一句当下的状态：${shortInput}`;
}

function buildInsightNote({ analysis, learningSession, behaviorHint }) {
  if (learningSession?.type === 'progress' && learningSession.status === 'stuck') {
    return '卡住本身就是信息，问题更适合继续拆小，而不是立刻换方向。';
  }

  if (learningSession?.type === 'progress' && learningSession.status === 'complete') {
    return '推进一小步比重新计划更有价值，闭环会慢慢把信心带回来。';
  }

  if (behaviorHint?.type === 'start_small') {
    return '当反复模式是拖延时，最有效的不是想通，而是先进入前五分钟。';
  }

  if (behaviorHint?.type === 'ground_state') {
    return '当情绪抢走注意力时，先落回一件眼前能做的事。';
  }

  if (analysis.intent === 'learning') {
    return '学习在这里不是多知道一点，而是把理解推进成动作。';
  }

  return '这轮对话更像一次对当下状态的对齐。';
}

function summarizeUserInput(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();

  if (cleaned.length <= 28) {
    return cleaned;
  }

  return `${cleaned.slice(0, 28)}...`;
}
