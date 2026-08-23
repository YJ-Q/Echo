import { CoreContractError } from '../core/contracts.js';
import { CONTRACT_VERSION } from '../contracts/contractTypes.js';
import {
  ContractValidationError,
  validateCommand,
  validateContractOutput,
  validateEventQuery,
  validateInvocationContext,
  validateQuery
} from '../contracts/validation.js';
import {
  toArtifactDTO,
  toCheckpointDTO,
  toDecisionDTO,
  toNeedsOwnerDTO,
  toRunDTO,
  toWorkstreamDTO
} from '../contracts/dtoMappers.js';
import { toActivityDTO, toEventEnvelope } from '../contracts/eventEnvelope.js';

const COMMAND_CAPABILITIES = Object.freeze({
  'workstream.create': 'workstream:write',
  'workstream.update': 'workstream:write',
  'run.create': 'run:control',
  'run.start': 'run:control',
  'run.pause': 'run:control',
  'run.resume': 'run:control',
  'run.stop': 'run:control',
  'checkpoint.create': 'checkpoint:write',
  'artifact.create': 'artifact:write',
  'needs_owner.create': 'needs_owner:write',
  'needs_owner.resolve': 'needs_owner:resolve'
});

const QUERY_CAPABILITIES = Object.freeze({
  'workstream.list': 'workstream:read',
  'workstream.get': 'workstream:read',
  'run.get': 'run:read',
  'run.list': 'run:read',
  'artifact.list': 'artifact:read',
  'decision.list': 'decision:read',
  'needs_owner.list': 'needs_owner:read',
  'activity.list': 'activity:read',
  'checkpoint.latest': 'checkpoint:read'
});

const KNOWN_ERROR_CODES = new Set([
  'invalid_request', 'permission_denied', 'capability_required', 'not_found',
  'version_conflict', 'idempotency_conflict', 'invalid_transition', 'open_run_conflict',
  'runtime_unavailable', 'runtime_control_required', 'storage_failure', 'workstream_not_found',
  'run_not_found', 'open_run_exists', 'cross_workstream_reference', 'invalid_workstream_transition'
]);

function requireCapability(context, capability, authorizeContext, requestType) {
  if (!context.capabilities.includes(capability)) throw new CoreContractError('capability_required', `Capability ${capability} is required`);
  if (authorizeContext && authorizeContext(context, capability, requestType) !== true) {
    throw new CoreContractError('permission_denied', 'Invocation context is not authorized');
  }
}

function mutationInput(command) {
  const input = { requestId: command.idempotencyKey, ...command.payload };
  if (command.expectedVersion !== undefined) input.expectedVersion = command.expectedVersion;
  return input;
}

function actorFor(context, toActor) {
  return toActor ? toActor(context) : {
    actorType: context.actor.type,
    subjectId: context.actor.subjectId,
    sourceSessionId: context.surface.instanceId ?? context.requestId,
    sourceEventId: context.requestId,
    correlationId: context.correlationId,
    surfaceKind: context.surface.kind
  };
}

function runtimeBoundary(runtimeControl) {
  if (!runtimeControl?.activate || !runtimeControl?.halt) return runtimeControl;
  return {
    async activate(run) {
      try { return await runtimeControl.activate(run); }
      catch { throw new CoreContractError('runtime_unavailable', 'Runtime activation is unavailable'); }
    },
    async halt(run) {
      try { return await runtimeControl.halt(run); }
      catch { throw new CoreContractError('runtime_unavailable', 'Runtime halt is unavailable'); }
    }
  };
}

function meta(context, auditId, stateVersion) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: context.requestId,
    correlationId: context.correlationId,
    ...(auditId ? { auditId } : {}),
    ...(Number.isInteger(stateVersion) ? { stateVersion } : {})
  };
}

function success(data, context, result = {}) {
  return validateContractOutput({ ok: true, data, meta: meta(context, result.auditId, data?.version ?? data?.stateVersion) });
}

function safeIdentity(value) {
  return typeof value === 'string' && value.trim() && value.length <= 2_000 ? value : 'invalid';
}

function failure(error, rawContext = {}, rawRequest = {}) {
  const known = error instanceof CoreContractError || error instanceof ContractValidationError;
  const code = known && KNOWN_ERROR_CODES.has(error.code) ? error.code : 'storage_failure';
  const details = code === 'version_conflict' && Number.isInteger(error.details?.actual)
    ? { currentVersion: error.details.actual }
    : undefined;
  const envelope = {
    ok: false,
    error: {
      code,
      retryable: ['storage_failure', 'runtime_unavailable'].includes(code),
      ...(details ? { details } : {})
    },
    meta: {
      contractVersion: CONTRACT_VERSION,
      requestId: safeIdentity(rawContext?.requestId ?? rawRequest?.requestId),
      correlationId: safeIdentity(rawContext?.correlationId)
    }
  };
  return validateContractOutput(envelope);
}

function notFound() { throw new CoreContractError('not_found', 'Requested resource was not found'); }

export function createMarginApplicationContract({ services, repository, runtimeControl, authorizeContext, toActor } = {}) {
  const runtime = runtimeBoundary(runtimeControl);

  const mapWorkstream = async (row, replayContext) => toWorkstreamDTO(row, replayContext === undefined ? {
    latestCheckpoint: await repository.latestCheckpointFor({ workstreamId: row.id }),
    activeRun: await repository.findOpenRun(row.id)
  } : replayContext);
  const mapRun = async (row, replayContext) => toRunDTO(row, replayContext === undefined
    ? { checkpoint: await repository.latestCheckpoint(row.id) }
    : replayContext);

  const commands = Object.freeze({
    'workstream.create': async (command, context, actor) => {
      const input = mutationInput(command);
      input.workspacePath = input.workspaceReference?.path;
      delete input.workspaceReference;
      return mappedAsync(await services.workstreams.create(input, actor), mapWorkstream);
    },
    'workstream.update': async (command, context, actor) => {
      const input = mutationInput(command);
      if (input.changes.workspaceReference !== undefined) {
        input.changes = { ...input.changes, workspacePath: input.changes.workspaceReference?.path ?? null };
        delete input.changes.workspaceReference;
      }
      return mappedAsync(await services.workstreams.update(input, actor), mapWorkstream);
    },
    'run.create': async (command, context, actor) => {
      const input = mutationInput(command);
      input.runtimeKind = input.workerKind;
      delete input.workerKind;
      return mappedAsync(await services.runs.create(input, actor), mapRun);
    },
    'run.start': (command, context, actor) => runControl('start', command, actor),
    'run.pause': (command, context, actor) => runControl('pause', command, actor),
    'run.resume': (command, context, actor) => runControl('resume', command, actor),
    'run.stop': (command, context, actor) => runControl('stop', command, actor),
    'checkpoint.create': async (command, context, actor) => mapped(await services.checkpoints.create(mutationInput(command), actor), toCheckpointDTO),
    'artifact.create': async (command, context, actor) => {
      const input = mutationInput(command);
      input.uri = input.resourceReference.uri;
      input.contentHash = input.resourceReference.contentHash;
      delete input.resourceReference;
      return mapped(await services.artifacts.create(input, actor), toArtifactDTO);
    },
    'needs_owner.create': async (command, context, actor) => mapped(await services.needsOwner.create(mutationInput(command), actor), toNeedsOwnerDTO),
    'needs_owner.resolve': async (command, context, actor) => mapped(await services.needsOwner.resolve(mutationInput(command), actor), toNeedsOwnerDTO)
  });

  async function runControl(operation, command, actor) {
    return mappedAsync(await services.runs[operation](mutationInput(command), actor, runtime), mapRun);
  }

  const queries = Object.freeze({
    'workstream.list': async (request) => {
      const page = await services.workstreams.list(request.payload);
      return pageMap(page, mapWorkstream);
    },
    'workstream.get': async (request) => {
      const row = await services.workstreams.get(request.payload.workstreamId);
      if (!row) return notFound();
      return mapWorkstream(row);
    },
    'run.get': async (request) => {
      const row = await services.runs.get(request.payload.runId);
      if (!row) return notFound();
      return mapRun(row);
    },
    'run.list': async (request) => pageMap(await services.runs.list(request.payload), mapRun),
    'artifact.list': async (request) => pageMap(await services.artifacts.list(request.payload), toArtifactDTO),
    'decision.list': async (request) => {
      const input = { ...request.payload };
      if (input.statuses) input.statuses = input.statuses.map((status) => status === 'active' ? 'confirmed' : status);
      return pageMap(await repository.listDecisions(input), toDecisionDTO);
    },
    'needs_owner.list': async (request) => pageMap(await services.needsOwner.list(request.payload), toNeedsOwnerDTO),
    'activity.list': async (request) => activityPage(request.payload),
    'checkpoint.latest': async (request) => {
      const row = await services.checkpoints.latest(request.payload);
      return row ? toCheckpointDTO(row) : null;
    }
  });

  async function dispatchMutation(rawCommand, rawContext) {
    try {
      const context = validateInvocationContext(rawContext);
      const command = validateCommand(rawCommand, context);
      requireCapability(context, COMMAND_CAPABILITIES[command.type], authorizeContext, command.type);
      const result = await commands[command.type](command, context, actorFor(context, toActor));
      return success(result.data, context, result);
    } catch (error) { return failure(error, rawContext, rawCommand); }
  }

  async function dispatchQuery(rawRequest, rawContext) {
    try {
      const context = validateInvocationContext(rawContext);
      const request = validateQuery(rawRequest, context);
      requireCapability(context, QUERY_CAPABILITIES[request.type], authorizeContext, request.type);
      return success(await queries[request.type](request), context);
    } catch (error) { return failure(error, rawContext, rawRequest); }
  }

  async function dispatchEvents(rawRequest, rawContext) {
    try {
      const context = validateInvocationContext(rawContext);
      const request = validateEventQuery(rawRequest, context);
      requireCapability(context, 'event:read', authorizeContext, request.type);
      return success(await eventPage(request.payload), context);
    } catch (error) { return failure(error, rawContext, rawRequest); }
  }

  async function eventPage(payload) {
    const page = await repository.listEventRows(payload);
    const mapped = page.items.map(toEventEnvelope);
    const items = mapped.filter((item) => item && (!payload.eventTypes || payload.eventTypes.includes(item.eventType)));
    return {
      items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      diagnostics: { skippedUnknownEvents: mapped.filter((item) => item === null).length }
    };
  }

  async function activityPage(payload) {
    const page = await eventPage(payload);
    return {
      items: page.items.map(toActivityDTO),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      diagnostics: page.diagnostics
    };
  }

  return Object.freeze({ execute: dispatchMutation, query: dispatchQuery, events: dispatchEvents });
}

function mapped(result, mapper) {
  return { ...result, data: mapper(result.data) };
}

async function mappedAsync(result, mapper) {
  return { ...result, data: await mapper(result.data, result.replayContext) };
}

async function pageMap(page, mapper) {
  return {
    items: await Promise.all(page.items.map((item) => mapper(item))),
    nextCursor: page.nextCursor ?? null
  };
}
