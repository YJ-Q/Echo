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
import { buildStateExplanation } from './explainabilityEngine.js';
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
  const nextAction = decideNextAction({
    context,
    profileSummary,
    currentSession,
    recentSummaries,
    pendingActions
  });
  const decision = explainDecision(nextAction);

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
    decision,
    explain: buildStateExplanation({
      context,
      profileSummary,
      currentSession,
      nextAction,
      decision
    }),
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
