import {
  getActions,
  getLearningSessions,
  getMemories,
  getSummaries,
  getUserProfile,
  getUserStates
} from '../storage/memoryStore.js';
import { decideNextAction, explainDecision } from './behaviorDecisionEngine.js';
import { buildContext } from './contextBuilder.js';
import { selectCurrentAction, sortActions } from './actionSelectionEngine.js';
import { buildStateExplanation } from './explainabilityEngine.js';
import { buildLearningViewModel, emptyLearningViewModel } from './learningViewModel.js';
import { buildMemoryViewModel } from './memoryViewModel.js';
import { summarizeProfile } from './profileEngine.js';
import { buildReflectionViewModel } from './reflectionViewModel.js';

export async function getEchoState(query = '') {
  const [
    context,
    recentMemories,
    activeLearningSessions,
    recentSummaries,
    activeActions,
    pendingActions,
    userProfile,
    userStates
  ] = await Promise.all([
    buildContext(query),
    getMemories({ limit: 5 }),
    getLearningSessions({ status: 'active', limit: 5 }),
    getSummaries({ limit: 7 }),
    getActions({ status: 'active', limit: 3 }),
    getActions({ status: 'pending', limit: 5 }),
    getUserProfile(),
    getUserStates({ limit: 12 })
  ]);
  const profileSummary = summarizeProfile(userProfile);
  const currentSession = activeLearningSessions[0] || null;
  const nextAction = decideNextAction({
    context,
    profileSummary,
    currentSession,
    recentSummaries,
    pendingActions
  });
  const decision = explainDecision(nextAction);
  const currentAction = buildCurrentAction({
    availableActions: [...activeActions, ...pendingActions],
    nextAction,
    currentSession
  });
  const orderedPendingActions = sortActions(pendingActions);
  const currentLearning = currentSession
    ? buildLearningViewModel(currentSession)
    : emptyLearningViewModel();
  const currentReflection = buildReflectionViewModel(recentSummaries);
  const currentMemory = buildMemoryViewModel(recentMemories);

  return {
    name: 'Margin',
    mode: 'backend-only',
    timestamp: new Date().toISOString(),
    current_state: {
      emotion: context.summary.dominant_emotion,
      focus: context.summary.current_learning_focus || profileSummary.current_learning_focus || '',
      pattern: context.summary.recurring_pattern || profileSummary.recurring_pattern || '',
      context_note: context.summary.context_note,
      profile_note: profileSummary.profile_note
    },
    next_action: nextAction,
    current_action: currentAction,
    current_learning: currentLearning,
    current_reflection: currentReflection,
    current_memory: currentMemory,
    decision,
    explain: buildStateExplanation({
      context,
      profileSummary,
      currentSession,
      recentSummaries,
      nextAction,
      decision
    }),
    action_queue: orderedPendingActions,
    active_learning: activeLearningSessions,
    recent_memories: recentMemories,
    recent_reflections: recentSummaries,
    profile: {
      raw: userProfile,
      summary: profileSummary
    },
    user_states: userStates
  };
}

function buildCurrentAction({
  availableActions = [],
  nextAction,
  currentSession
}) {
  const sourceAction = selectCurrentAction(availableActions);

  if (sourceAction) {
    return {
      id: sourceAction.id,
      type: sourceAction.type,
      title: sourceAction.title,
      detail: sourceAction.detail,
      status: sourceAction.status,
      source: sourceAction.source,
      priority: sourceAction.priority,
      progress: buildActionLearningProgress(currentSession, sourceAction),
      current_step: buildActionCurrentStep(currentSession, sourceAction),
      completion_hint: buildCompletionHint(sourceAction, currentSession)
    };
  }

  return {
    id: null,
    type: nextAction.type,
    title: nextAction.label,
    detail: nextAction.detail,
    status: 'suggested',
    source: nextAction.source,
    priority: null,
    progress: buildActionLearningProgress(currentSession, nextAction),
    current_step: buildActionCurrentStep(currentSession, nextAction),
    completion_hint: buildCompletionHint(nextAction, currentSession)
  };
}

function buildActionLearningProgress(currentSession, actionLike) {
  if (!currentSession || !isLearningLikeAction(actionLike?.type)) {
    return null;
  }

  const total = currentSession.steps.length;
  const completed = currentSession.steps.filter((step) => step.status === 'done').length;
  const currentIndex = currentSession.current_step;
  const ratio = total > 0 ? Number((completed / total).toFixed(2)) : 0;

  return {
    topic: currentSession.topic,
    completed_steps: completed,
    total_steps: total,
    current_step_index: currentIndex,
    ratio
  };
}

function buildActionCurrentStep(currentSession, actionLike) {
  if (!currentSession || !isLearningLikeAction(actionLike?.type)) {
    return null;
  }

  const step = currentSession.steps[currentSession.current_step];

  if (!step) {
    return null;
  }

  return {
    index: currentSession.current_step,
    title: step.title,
    action: step.action,
    status: step.status
  };
}

function buildCompletionHint(actionLike, currentSession) {
  if (currentSession && isLearningLikeAction(actionLike?.type)) {
    const step = currentSession.steps[currentSession.current_step];
    return step ? `完成“${step.title}”这一步即可继续推进。` : '完成当前学习步骤即可继续推进。';
  }

  const hints = {
    start_small: '先完成一个足够小、能立刻发生的动作。',
    ground_state: '把注意力落回此刻能做的那一步。',
    reflect_recent: '读完最近一条反思，并留下一个回应。',
    open_conversation: '写下一句当前状态，让系统继续理解我们。',
    resume_pending_action: '把之前已经决定的动作重新接上。'
  };

  return hints[actionLike?.type] || '完成当前动作后，再决定下一步。';
}

function isLearningLikeAction(type) {
  return ['continue_learning', 'resume_pending_action'].includes(type);
}
