export function decideNextAction({
  context,
  profileSummary,
  currentSession,
  recentSummaries = [],
  pendingActions = []
}) {
  const currentStep = currentSession?.steps?.[currentSession.current_step];
  const recurringPattern = context?.summary?.recurring_pattern || profileSummary?.recurring_pattern || '';
  const dominantEmotion = context?.summary?.dominant_emotion || 'neutral';
  const promptContext = context?.injection?.prompt_context || '';
  const openPendingAction = pendingActions[0] || null;

  if (currentStep) {
    return {
      type: 'continue_learning',
      label: `继续：${currentStep.title}`,
      detail: currentStep.action,
      reason: `学习线“${currentSession.topic}”还在进行中。`,
      source: 'active_learning_session',
      confidence: 0.92
    };
  }

  if (openPendingAction && openPendingAction.source === 'echo_state') {
    return {
      type: 'resume_pending_action',
      label: `接着做：${openPendingAction.title}`,
      detail: openPendingAction.detail || '把已经决定的那一步重新接上。',
      reason: '我们已经给过自己一个下一步，不必每次都重新判断。',
      source: 'pending_action_queue',
      confidence: 0.84
    };
  }

  if (recurringPattern || profileSummary?.start_friction) {
    return {
      type: 'start_small',
      label: '先做 5 分钟',
      detail: '把当前任务缩到一个能立刻开始的小动作。',
      reason: '我们的阻力更常出现在开始前。',
      source: 'recurring_pattern',
      confidence: 0.8
    };
  }

  if (dominantEmotion === 'anxious') {
    return {
      type: 'ground_state',
      label: '先落回眼前',
      detail: '先写下一件此刻能做的事，不处理整天，只处理下一步。',
      reason: '情绪已经开始抢走注意力，先把自己放回当下。',
      source: 'emotional_state',
      confidence: 0.72
    };
  }

  if (recentSummaries.length > 0) {
    return {
      type: 'reflect_recent',
      label: '读一遍最近的回声',
      detail: recentSummaries[0].echo_reflection,
      reason: '最近已经有反思记录，可以从那里接上。',
      source: 'recent_reflection',
      confidence: 0.64
    };
  }

  return {
    type: 'open_conversation',
    label: '留下一句现在的状态',
    detail: promptContext || '不用整理成问题，只说我们此刻在哪里。',
    reason: '还没有足够的记忆形成稳定模式。',
    source: 'conversation_opening',
    confidence: 0.55
  };
}

export function explainDecision(action) {
  return {
    source: action.source,
    confidence: action.confidence,
    rule: action.type
  };
}
