export const WORKSTREAM_STATUSES = Object.freeze([
  'running', 'ready', 'waiting', 'watching', 'blocked', 'needs_owner', 'paused', 'completed'
]);

const TRANSITIONS = Object.freeze({
  running: { pause: 'paused', block: 'blocked', wait: 'waiting', watch: 'watching', needs_owner: 'needs_owner', complete: 'completed' },
  ready: { start: 'running', pause: 'paused', complete: 'completed' },
  waiting: { ready: 'ready', pause: 'paused', needs_owner: 'needs_owner', complete: 'completed' },
  watching: { ready: 'ready', pause: 'paused', needs_owner: 'needs_owner', complete: 'completed' },
  blocked: { resume: 'running', pause: 'paused', needs_owner: 'needs_owner', complete: 'completed' },
  needs_owner: { resume: 'running', pause: 'paused', complete: 'completed' },
  paused: { resume: 'running', complete: 'completed' },
  completed: {}
});

export function transitionWorkstream(current, command) {
  const next = TRANSITIONS[current?.status]?.[command?.type];
  if (!next) throw Object.assign(new Error('invalid_workstream_transition'), { code: 'invalid_workstream_transition' });
  return { ...current, status: next };
}
