import {
  ACTOR_TYPES, COMMAND_TYPES, EVENT_QUERY_TYPES, EVENT_TYPES, NEEDS_OWNER_STATUSES, NEEDS_OWNER_TYPES,
  QUERY_TYPES, RUN_STATUSES, SURFACE_KINDS, WORKER_KINDS, WORKSTREAM_STATUSES
} from './contractTypes.js';

const MAX_STRING = 2_000;
const MAX_METADATA_BYTES = 16_384;

export class ContractValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'ContractValidationError'; this.code = code; }
}

export function invalid(message) { return new ContractValidationError('invalid_request', message); }
export function assertClosedObject(value, keys, label = 'object') {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !keys.includes(key))) throw invalid(`${label} has unsupported fields`);
  return value;
}
export function requireString(value, label, max = MAX_STRING) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${label} must be a bounded string`);
  return value;
}
export function optionalString(value, label, max = MAX_STRING) {
  if (value === undefined || value === null) return value ?? null;
  return requireString(value, label, max);
}
export function requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${label} must be an integer`);
  return value;
}
export function requireEnum(value, values, label = 'value') {
  if (!values.includes(value)) throw invalid(`${label} is invalid`);
  return value;
}
export function boundedStringArray(value, label, max = 20) {
  if (!Array.isArray(value) || value.length > max) throw invalid(`${label} must be a bounded string array`);
  value.forEach((item) => requireString(item, label));
  return value;
}
export function boundedJsonObject(value, label, maxBytes = MAX_METADATA_BYTES) {
  if (!isPlainObject(value) || !isSafeJson(value)) throw invalid(`${label} must be a bounded JSON object`);
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw invalid(`${label} must be a bounded JSON object`);
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    throw invalid(`${label} must be a bounded JSON object`);
  }
  return value;
}

export function validateInvocationContext(context) {
  assertClosedObject(context, ['actor', 'surface', 'requestId', 'correlationId', 'capabilities', 'hostAuthority'], 'InvocationContext');
  assertClosedObject(context.actor, ['type', 'subjectId'], 'actor');
  requireEnum(context.actor.type, ACTOR_TYPES, 'actor.type');
  requireString(context.actor.subjectId, 'actor.subjectId');
  assertClosedObject(context.surface, ['kind', 'instanceId'], 'surface');
  requireEnum(context.surface.kind, SURFACE_KINDS, 'surface.kind');
  optionalString(context.surface.instanceId, 'surface.instanceId');
  requireString(context.requestId, 'requestId');
  requireString(context.correlationId, 'correlationId');
  boundedStringArray(context.capabilities, 'capabilities', 50);
  return context;
}

export function validateCommand(command, context) {
  validateInvocationContext(context);
  const base = assertClosedObject(command, ['type', 'requestId', 'idempotencyKey', 'expectedVersion', 'payload'], 'command');
  requireEnum(base.type, COMMAND_TYPES, 'command.type');
  requireString(base.requestId, 'command.requestId');
  if (base.requestId !== context.requestId) throw invalid('requestId must match context');
  requireString(base.idempotencyKey, 'idempotencyKey');
  if (!isPlainObject(base.payload)) throw invalid('command.payload must be an object');
  COMMAND_VALIDATORS[base.type](base);
  return command;
}

export function validateQuery(query, context) {
  validateInvocationContext(context);
  return validateRequest(query, context, QUERY_TYPES, QUERY_VALIDATORS, 'query');
}

export function validateEventQuery(query, context) {
  validateInvocationContext(context);
  return validateRequest(query, context, EVENT_QUERY_TYPES, EVENT_QUERY_VALIDATORS, 'event query');
}

export function validateContractOutput(output) {
  scanOutput(output);
  return deepFreeze(output);
}

function validateRequest(request, context, types, validators, label) {
  const base = assertClosedObject(request, ['type', 'requestId', 'payload'], label);
  requireEnum(base.type, types, `${label}.type`);
  requireString(base.requestId, `${label}.requestId`);
  if (base.requestId !== context.requestId) throw invalid('requestId must match context');
  validators[base.type](base.payload);
  return request;
}

function mutation(base, payloadKeys, validator, requiresVersion = false) {
  assertClosedObject(base.payload, payloadKeys, `${base.type}.payload`);
  if (requiresVersion) requireInteger(base.expectedVersion, 'expectedVersion', { min: 1 });
  else if (base.expectedVersion !== undefined) requireInteger(base.expectedVersion, 'expectedVersion', { min: 1 });
  validator(base.payload);
}
const requiredId = (value, label) => requireString(value, label, 200);
const optionalId = (value, label) => optionalString(value, label, 200);
const optionalList = (value, label, max = 20) => value === undefined ? value : boundedStringArray(value, label, max);
const workspaceReference = (value) => {
  if (value === undefined || value === null) return;
  assertClosedObject(value, ['kind', 'path'], 'workspaceReference'); requireEnum(value.kind, ['local_path'], 'workspaceReference.kind'); requireString(value.path, 'workspaceReference.path');
};
const resourceReference = (value) => { assertClosedObject(value, ['uri', 'contentHash'], 'resourceReference'); requireString(value.uri, 'resourceReference.uri'); requireString(value.contentHash, 'resourceReference.contentHash'); };
const metadata = (value, label) => { if (value !== undefined) boundedJsonObject(value, label); };
const changes = (value) => {
  assertClosedObject(value, ['goal', 'phase', 'status', 'priority', 'currentState', 'currentPlan', 'nextAction', 'autonomyLevel', 'workspaceReference'], 'changes');
  if (!Object.keys(value).length) throw invalid('changes cannot be empty');
  if (value.goal !== undefined) requireString(value.goal, 'changes.goal');
  if (value.phase !== undefined) requireString(value.phase, 'changes.phase');
  if (value.status !== undefined) requireEnum(value.status, WORKSTREAM_STATUSES, 'changes.status');
  if (value.priority !== undefined) requireInteger(value.priority, 'changes.priority');
  if (value.currentState !== undefined && value.currentState !== null) requireString(value.currentState, 'changes.currentState');
  if (value.currentPlan !== undefined) boundedStringArray(value.currentPlan, 'changes.currentPlan');
  if (value.nextAction !== undefined && value.nextAction !== null) requireString(value.nextAction, 'changes.nextAction');
  if (value.autonomyLevel !== undefined) requireInteger(value.autonomyLevel, 'changes.autonomyLevel');
  workspaceReference(value.workspaceReference);
};

const COMMAND_VALIDATORS = Object.freeze({
  'workstream.create': (base) => mutation(base, ['title', 'goal', 'scenario', 'priority', 'currentPlan', 'nextAction', 'autonomyLevel', 'workspaceReference'], (p) => { requireString(p.title, 'title'); requireString(p.goal, 'goal'); requireEnum(p.scenario, ['career_project', 'learning_research'], 'scenario'); if (p.priority !== undefined) requireInteger(p.priority, 'priority'); optionalList(p.currentPlan, 'currentPlan'); if (p.nextAction !== undefined) requireString(p.nextAction, 'nextAction'); if (p.autonomyLevel !== undefined) requireInteger(p.autonomyLevel, 'autonomyLevel'); workspaceReference(p.workspaceReference); }),
  'workstream.update': (base) => mutation(base, ['workstreamId', 'changes'], (p) => { requiredId(p.workstreamId, 'workstreamId'); changes(p.changes); }, true),
  'run.create': (base) => mutation(base, ['workstreamId', 'workerKind', 'scope', 'stopCondition', 'allowedActions', 'forbiddenActions'], (p) => { requiredId(p.workstreamId, 'workstreamId'); requireEnum(p.workerKind, WORKER_KINDS, 'workerKind'); requireString(p.scope, 'scope'); optionalString(p.stopCondition, 'stopCondition'); optionalList(p.allowedActions, 'allowedActions'); optionalList(p.forbiddenActions, 'forbiddenActions'); }),
  'run.start': (base) => mutation(base, ['runId'], (p) => requiredId(p.runId, 'runId'), true),
  'run.pause': (base) => mutation(base, ['runId'], (p) => requiredId(p.runId, 'runId'), true),
  'run.resume': (base) => mutation(base, ['runId'], (p) => requiredId(p.runId, 'runId'), true),
  'run.stop': (base) => mutation(base, ['runId'], (p) => requiredId(p.runId, 'runId'), true),
  'checkpoint.create': (base) => mutation(base, ['workstreamId', 'runId', 'runVersion', 'stateVersion', 'stateDigest', 'gitRef', 'note'], (p) => { requiredId(p.workstreamId, 'workstreamId'); optionalId(p.runId, 'runId'); if (p.runVersion !== undefined) requireInteger(p.runVersion, 'runVersion', { min: 1 }); requireInteger(p.stateVersion, 'stateVersion', { min: 0 }); requireString(p.stateDigest, 'stateDigest'); optionalString(p.gitRef, 'gitRef'); optionalString(p.note, 'note'); }),
  'artifact.create': (base) => mutation(base, ['workstreamId', 'runId', 'type', 'title', 'resourceReference', 'metadata', 'previewMetadata'], (p) => { requiredId(p.workstreamId, 'workstreamId'); optionalId(p.runId, 'runId'); requireString(p.type, 'type'); requireString(p.title, 'title'); resourceReference(p.resourceReference); metadata(p.metadata, 'metadata'); metadata(p.previewMetadata, 'previewMetadata'); }),
  'needs_owner.create': (base) => mutation(base, ['workstreamId', 'runId', 'type', 'reason', 'options', 'consequenceSummary', 'contextSummary'], (p) => { requiredId(p.workstreamId, 'workstreamId'); optionalId(p.runId, 'runId'); requireEnum(p.type, NEEDS_OWNER_TYPES, 'type'); requireString(p.reason, 'reason'); if (!Array.isArray(p.options) || p.options.length > 10) throw invalid('options must be bounded'); p.options.forEach((o) => { assertClosedObject(o, ['id', 'label', 'consequenceSummary'], 'option'); requiredId(o.id, 'option.id'); requireString(o.label, 'option.label'); optionalString(o.consequenceSummary, 'option.consequenceSummary'); }); optionalString(p.consequenceSummary, 'consequenceSummary'); optionalString(p.contextSummary, 'contextSummary'); }),
  'needs_owner.resolve': (base) => mutation(base, ['needsOwnerId', 'optionId', 'resolutionSummary'], (p) => { requiredId(p.needsOwnerId, 'needsOwnerId'); optionalId(p.optionId, 'optionId'); optionalString(p.resolutionSummary, 'resolutionSummary'); }, true)
});

const listPayload = (payload, keys, required = [], statuses = null) => { assertClosedObject(payload, keys, 'query.payload'); required.forEach((key) => requiredId(payload[key], key)); if (payload.limit !== undefined) requireInteger(payload.limit, 'limit', { min: 1, max: 100 }); if (payload.cursor !== undefined && payload.cursor !== null) requireString(payload.cursor, 'cursor'); if (payload.statuses !== undefined) { boundedStringArray(payload.statuses, 'statuses', 20); if (statuses) payload.statuses.forEach((status) => requireEnum(status, statuses, 'status')); } };
const QUERY_VALIDATORS = Object.freeze({
  'workstream.list': (p) => listPayload(p, ['statuses', 'limit', 'cursor'], [], WORKSTREAM_STATUSES),
  'workstream.get': (p) => listPayload(p, ['workstreamId'], ['workstreamId']),
  'run.get': (p) => listPayload(p, ['runId'], ['runId']),
  'run.list': (p) => listPayload(p, ['workstreamId', 'statuses', 'limit', 'cursor'], ['workstreamId'], RUN_STATUSES),
  'artifact.list': (p) => listPayload(p, ['workstreamId', 'runId', 'limit', 'cursor'], ['workstreamId']),
  'decision.list': (p) => listPayload(p, ['workstreamId', 'statuses', 'limit', 'cursor'], ['workstreamId'], ['active', 'superseded', 'revoked']),
  'needs_owner.list': (p) => listPayload(p, ['workstreamId', 'runId', 'statuses', 'limit', 'cursor'], [], NEEDS_OWNER_STATUSES),
  'activity.list': (p) => { assertClosedObject(p, ['workstreamId', 'afterCursor', 'limit'], 'query.payload'); requiredId(p.workstreamId, 'workstreamId'); if (p.afterCursor !== undefined) requireInteger(p.afterCursor, 'afterCursor'); if (p.limit !== undefined) requireInteger(p.limit, 'limit', { min: 1, max: 100 }); },
  'checkpoint.latest': (p) => listPayload(p, ['workstreamId', 'runId'], ['workstreamId'])
});
const EVENT_QUERY_VALIDATORS = Object.freeze({
  'event.list': (p) => { assertClosedObject(p, ['afterCursor', 'workstreamId', 'eventTypes', 'limit'], 'event.payload'); if (p.afterCursor !== undefined) requireInteger(p.afterCursor, 'afterCursor'); optionalId(p.workstreamId, 'workstreamId'); if (p.eventTypes !== undefined) { boundedStringArray(p.eventTypes, 'eventTypes', 20); p.eventTypes.forEach((type) => requireEnum(type, EVENT_TYPES, 'eventType')); } if (p.limit !== undefined) requireInteger(p.limit, 'limit', { min: 1, max: 100 }); }
});

function scanOutput(value, key = '') {
  if (typeof value === 'function' || value instanceof Error || Buffer.isBuffer(value) || value instanceof Date || value instanceof Map || value instanceof Set || value === undefined) throw invalid('output contains a non-DTO value');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) { value.forEach((item) => scanOutput(item)); return; }
  if (!isPlainObject(value)) throw invalid('output must be plain');
  for (const [childKey, child] of Object.entries(value)) {
    if (isForbiddenKey(childKey) || childKey === 'hostAuthority') throw invalid(`forbidden output key: ${childKey}`);
    scanOutput(child, childKey);
  }
}
export function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function isPlainObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
function isSafeJson(value) { if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true; if (Array.isArray(value)) return value.every(isSafeJson); return isPlainObject(value) && Object.entries(value).every(([key, child]) => !isForbiddenKey(key) && isSafeJson(child)); }
function isForbiddenKey(key) { return key.includes('_') || ['chainOfThought', 'reasoning', 'prompt', 'apiKey', 'sessionObject', 'runtime', 'runtimeSessionId', 'sourceSessionId', 'hostAuthority', 'stack'].includes(key); }
