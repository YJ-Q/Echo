export const CONTRACT_VERSION = '1.0';

export const COMMAND_TYPES = Object.freeze([
  'workstream.create', 'workstream.update',
  'run.create', 'run.start', 'run.pause', 'run.resume', 'run.stop',
  'checkpoint.create', 'artifact.create',
  'needs_owner.create', 'needs_owner.resolve'
]);

export const QUERY_TYPES = Object.freeze([
  'workstream.list', 'workstream.get', 'run.get', 'run.list',
  'artifact.list', 'decision.list', 'needs_owner.list',
  'activity.list', 'checkpoint.latest'
]);

export const EVENT_QUERY_TYPES = Object.freeze(['event.list']);

export const EVENT_TYPES = Object.freeze([
  'workstream.created', 'workstream.updated', 'run.created', 'run.started',
  'run.progressed', 'run.paused', 'run.resumed', 'run.stopped', 'run.completed',
  'run.failed', 'checkpoint.created', 'artifact.created', 'decision.created',
  'decision.superseded', 'decision.revoked', 'needs_owner.created',
  'needs_owner.resolved', 'needs_owner.cancelled'
]);

export const ACTOR_TYPES = Object.freeze(['user', 'agent', 'system']);
export const SURFACE_KINDS = Object.freeze(['cli', 'web', 'feishu', 'scheduler', 'worker']);
export const WORKSTREAM_STATUSES = Object.freeze(['running', 'ready', 'waiting', 'watching', 'blocked', 'needs_owner', 'paused', 'completed']);
export const RUN_STATUSES = Object.freeze(['queued', 'running', 'paused', 'completed', 'failed', 'needs_owner', 'cancelled']);
export const NEEDS_OWNER_TYPES = Object.freeze(['decision', 'approval', 'input', 'conflict']);
export const NEEDS_OWNER_STATUSES = Object.freeze(['open', 'resolved', 'cancelled']);
export const WORKER_KINDS = Object.freeze(['pi', 'codex', 'other']);
