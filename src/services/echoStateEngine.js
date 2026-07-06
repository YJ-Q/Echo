import {
  getActions,
  getLearningSessions,
  getMemories,
  getSummaries,
  getUserProfile,
  getUserStates
} from '../storage/memoryStore.js';
import { buildContext } from './contextBuilder.js';
import { summarizeProfile } from './profileEngine.js';

export async function getEchoState(query = '') {
  const [
    context,
    recentMemories,
    activeLearningSessions,
    recentSummaries,
    pendingActions,
    userProfile,
    userStates
  ] = await Promise.all([
    buildContext(query),
    getMemories({ limit: 5 }),
    getLearningSessions({ status: 'active', limit: 5 }),
    getSummaries({ limit: 3 }),
    getActions({ status: 'pending', limit: 5 }),
    getUserProfile(),
    getUserStates({ limit: 12 })
  ]);
  const profileSummary = summarizeProfile(userProfile);
  const currentSession = activeLearningSessions[0] || null;
  const nextAction = buildNextAction({
    context,
    profileSummary,
    currentSession,
    recentSummaries
  });

  return {
    name: 'Echo',
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
    action_queue: pendingActions,
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

function buildNextAction({
  context,
  profileSummary,
  currentSession,
  recentSummaries
}) {
  const currentStep = currentSession?.steps?.[currentSession.current_step];

  if (currentStep) {
    return {
      type: 'continue_learning',
      label: `继续：${currentStep.title}`,
      detail: currentStep.action,
      reason: `学习线“${currentSession.topic}”还在进行中。`
    };
  }

  if (context.summary.recurring_pattern || profileSummary.start_friction) {
    return {
      type: 'start_small',
      label: '先做 5 分钟',
      detail: '把当前任务缩到一个能立刻开始的小动作。',
      reason: '我们的阻力更常出现在开始前。'
    };
  }

  if (recentSummaries.length > 0) {
    return {
      type: 'reflect_recent',
      label: '读一遍最近的回声',
      detail: recentSummaries[0].echo_reflection,
      reason: '最近已经有反思记录，可以从那里接上。'
    };
  }

  return {
    type: 'open_conversation',
    label: '留下一句现在的状态',
    detail: '不用整理成问题，只说我们此刻在哪里。',
    reason: '还没有足够的记忆形成稳定模式。'
  };
}
