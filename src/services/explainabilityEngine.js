export function buildChatExplanation({
  analysis,
  memoryContext,
  learningSession,
  decision,
  reply,
  tone,
  agent
}) {
  const currentStep = learningSession?.session?.steps?.[learningSession?.session?.current_step];

  return {
    summary: buildChatSummary({ analysis, memoryContext, learningSession, decision }),
    input_analysis: {
      intent: analysis.intent,
      emotion: analysis.emotion,
      tags: analysis.tags
    },
    context_signals: {
      dominant_emotion: memoryContext.summary.dominant_emotion,
      current_learning_focus: memoryContext.summary.current_learning_focus || '',
      recurring_pattern: memoryContext.summary.recurring_pattern || '',
      profile_note: memoryContext.summary.profile_note || '',
      latest_memory_note: memoryContext.summary.latest_memory_note || '',
      prompt_context: memoryContext.injection.prompt_context || ''
    },
    response_strategy: {
      mode: inferReplyMode({ analysis, learningSession }),
      current_step: currentStep
        ? {
            title: currentStep.title,
            action: currentStep.action
          }
        : null,
      tone,
      provider: agent.provider,
      fallback_used: agent.fallback_used
    },
    next_action: {
      type: decision?.rule || null,
      source: decision?.source || null,
      confidence: decision?.confidence ?? null,
      reason: decision?.reason || '',
      label: decision?.label || '',
      detail: decision?.detail || ''
    },
    reply_preview: reply
  };
}

export function buildStateExplanation({
  context,
  profileSummary,
  currentSession,
  nextAction,
  decision
}) {
  const currentStep = currentSession?.steps?.[currentSession?.current_step];

  return {
    summary: buildStateSummary({ context, currentSession, nextAction }),
    context_signals: {
      dominant_emotion: context.summary.dominant_emotion,
      dominant_tag: context.summary.dominant_tag,
      current_learning_focus: context.summary.current_learning_focus || '',
      recurring_pattern: context.summary.recurring_pattern || '',
      context_note: context.summary.context_note || '',
      profile_note: profileSummary.profile_note || ''
    },
    active_learning_signal: currentStep
      ? {
          topic: currentSession.topic,
          step_title: currentStep.title,
          step_action: currentStep.action
        }
      : null,
    decision_trace: {
      rule: decision.rule,
      source: decision.source,
      confidence: decision.confidence,
      label: nextAction.label,
      detail: nextAction.detail,
      reason: nextAction.reason
    }
  };
}

function buildChatSummary({ analysis, memoryContext, learningSession, decision }) {
  if (learningSession?.session?.topic) {
    return `这次回复围绕“${learningSession.session.topic}”这条学习线展开，同时保留了一个可执行的下一步。`;
  }

  if (analysis.intent === 'struggle') {
    return '这次回复优先照见阻力，而不是直接给一串建议；下一步保持尽量小。';
  }

  if (analysis.intent === 'planning') {
    return '这次回复优先收束任务边界，避免把计划本身变成拖延。';
  }

  if (memoryContext.summary.recurring_pattern || decision?.rule === 'start_small') {
    return '这次回复参考了最近反复出现的模式，所以把重点放在开始动作上。';
  }

  return '这次回复主要依据当前输入和最近记忆，先把我们放回一个更清楚的位置。';
}

function buildStateSummary({ context, currentSession, nextAction }) {
  if (currentSession?.topic) {
    return `当前系统判断我们仍在“${currentSession.topic}”这条线上，因此优先建议继续而不是重新开始。`;
  }

  if (nextAction.type === 'resume_pending_action') {
    return '当前系统判断队列里已经有未完成动作，所以先接回去，不重新开题。';
  }

  if (context.summary.recurring_pattern) {
    return `当前系统把“${context.summary.recurring_pattern}”视为一个反复信号，因此建议先缩小动作。`;
  }

  return '当前系统还在继续积累模式，所以建议先留下一句状态或一个最小动作。';
}

function inferReplyMode({ analysis, learningSession }) {
  if (learningSession?.type === 'progress') {
    if (learningSession.status === 'complete') return 'learning_progress';
    if (learningSession.status === 'stuck') return 'learning_unblock';
    if (learningSession.status === 'partial') return 'learning_followup';
  }

  if (analysis.intent === 'learning') return 'learning_guidance';
  if (analysis.intent === 'struggle') return 'reflective_unblock';
  if (analysis.intent === 'planning') return 'planning_narrow';
  if (analysis.emotion === 'anxious') return 'grounding_reflection';

  return 'reflective_chat';
}
