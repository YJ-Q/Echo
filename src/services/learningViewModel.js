export function buildLearningViewModel(session) {
  if (!session) {
    return emptyLearningViewModel();
  }

  const steps = Array.isArray(session.steps) ? session.steps : [];
  const totalSteps = steps.length;
  const completedSteps = steps.filter((step) => step.status === 'done').length;
  const currentIndex = Number.isFinite(session.current_step) ? session.current_step : 0;
  const currentStep = steps[currentIndex] || null;
  const nextPendingStep = steps.find((step, index) => index > currentIndex && step.status !== 'done') || null;
  const ratio = totalSteps > 0 ? Number((completedSteps / totalSteps).toFixed(2)) : 0;

  return {
    id: session.id,
    topic: session.topic,
    status: session.status,
    total_steps: totalSteps,
    completed_steps: completedSteps,
    current_step_index: currentIndex,
    ratio,
    step_labels: steps.map((step, index) => ({
      index,
      title: step.title,
      status: step.status
    })),
    current_step: currentStep
      ? {
          index: currentIndex,
          title: currentStep.title,
          action: currentStep.action || '',
          status: currentStep.status
        }
      : null,
    next_step: nextPendingStep
      ? {
          index: steps.indexOf(nextPendingStep),
          title: nextPendingStep.title,
          action: nextPendingStep.action || '',
          status: nextPendingStep.status
        }
      : null,
    summary: buildLearningSummary(session, currentStep, completedSteps, totalSteps)
  };
}

export function emptyLearningViewModel() {
  return {
    id: null,
    topic: '',
    status: 'idle',
    total_steps: 0,
    completed_steps: 0,
    current_step_index: 0,
    ratio: 0,
    step_labels: [],
    current_step: null,
    next_step: null,
    summary: '还没有激活中的学习线。'
  };
}

function buildLearningSummary(session, currentStep, completedSteps, totalSteps) {
  if (session.status === 'completed') {
    return `“${session.topic}”这一轮已经完成，共走完 ${totalSteps} 步。`;
  }

  if (currentStep) {
    return `当前学习线是“${session.topic}”，正在推进“${currentStep.title}”，已完成 ${completedSteps}/${totalSteps} 步。`;
  }

  return `当前学习线是“${session.topic}”。`;
}
