export const RUN_STATUSES = Object.freeze([
  'queued', 'running', 'paused', 'completed', 'failed', 'needs_owner', 'cancelled'
]);

const TRANSITIONS = Object.freeze({
  queued: { start: 'running', stop: 'cancelled' },
  running: { pause: 'paused', stop: 'cancelled', complete: 'completed', fail: 'failed', needs_owner: 'needs_owner' },
  paused: { resume: 'running', stop: 'cancelled' },
  needs_owner: { resume: 'running', stop: 'cancelled', fail: 'failed' },
  completed: {}, failed: {}, cancelled: {}
});

export function transitionRun(current, command) {
  const next = TRANSITIONS[current?.status]?.[command?.type];
  if (!next) throw Object.assign(new Error('invalid_run_transition'), { code: 'invalid_run_transition' });
  return { ...current, status: next };
}
