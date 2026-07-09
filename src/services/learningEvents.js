export const LEARNING_EVENT_TYPES = Object.freeze({
  SESSION_CREATED: 'session_created',
  SESSION_REUSED: 'session_reused',
  STEP_COMPLETED: 'step_completed',
  STEP_STUCK: 'step_stuck',
  STEP_ATTEMPTED: 'step_attempted',
  MANUAL_STEP_PENDING: 'manual_step_pending',
  MANUAL_STEP_ACTIVE: 'manual_step_active',
  MANUAL_STEP_DONE: 'manual_step_done'
});

export function buildLearningEvent({
  session,
  eventType,
  stepIndex = session?.current_step,
  note,
  reason,
  userInput
}) {
  const step = Number.isInteger(stepIndex) ? session?.steps?.[stepIndex] : null;

  return {
    sessionId: session?.id,
    topic: session?.topic || '这件事',
    eventType,
    stepIndex: Number.isInteger(stepIndex) ? stepIndex : null,
    stepTitle: step?.title || null,
    note: note || formatLearningEventNote(eventType, { reason }),
    userInput: userInput || null
  };
}

export function buildManualStepEvent({
  session,
  stepIndex,
  status,
  userInput
}) {
  const eventType = manualEventTypeForStatus(status);

  return buildLearningEvent({
    session,
    eventType,
    stepIndex,
    reason: `manual_status_${status}`,
    userInput
  });
}

export function buildActionStepDoneEvent({
  session,
  stepIndex,
  action
}) {
  return buildLearningEvent({
    session,
    eventType: LEARNING_EVENT_TYPES.MANUAL_STEP_DONE,
    stepIndex,
    reason: `action_status_done:${action?.id || 'unknown'}`,
    userInput: null
  });
}

function manualEventTypeForStatus(status) {
  const manualTypes = {
    pending: LEARNING_EVENT_TYPES.MANUAL_STEP_PENDING,
    active: LEARNING_EVENT_TYPES.MANUAL_STEP_ACTIVE,
    done: LEARNING_EVENT_TYPES.MANUAL_STEP_DONE
  };

  return manualTypes[status] || LEARNING_EVENT_TYPES.MANUAL_STEP_DONE;
}

function formatLearningEventNote(eventType, { reason } = {}) {
  const notes = {
    [LEARNING_EVENT_TYPES.SESSION_CREATED]: 'Learning session created from a learning intent.',
    [LEARNING_EVENT_TYPES.SESSION_REUSED]: 'Existing learning session reused for the same topic.',
    [LEARNING_EVENT_TYPES.STEP_COMPLETED]: 'Learning step completed by automatic progress assessment.',
    [LEARNING_EVENT_TYPES.STEP_STUCK]: 'Learning step marked stuck by automatic progress assessment.',
    [LEARNING_EVENT_TYPES.STEP_ATTEMPTED]: 'Learning step attempted by automatic progress assessment.',
    [LEARNING_EVENT_TYPES.MANUAL_STEP_PENDING]: 'Learning step manually changed to pending.',
    [LEARNING_EVENT_TYPES.MANUAL_STEP_ACTIVE]: 'Learning step manually changed to active.',
    [LEARNING_EVENT_TYPES.MANUAL_STEP_DONE]: 'Learning step manually changed to done.'
  };
  const note = notes[eventType] || 'Learning event recorded.';

  return reason ? `${note} Reason: ${reason}.` : note;
}
