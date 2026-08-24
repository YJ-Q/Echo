import { digestInput } from '../core/contracts.js';
import { routeContinuityInput } from '../continuity/memoryWriteRouter.js';

const MAX_MESSAGE_LENGTH = 2_000;
const OPEN_ACTION_STATUSES = new Set(['pending', 'active', 'in_progress', 'blocked', 'waiting']);
const SAFE_GATEWAY_CODES = new Set([
  'invalid_request', 'permission_denied', 'not_found', 'version_conflict', 'invalid_transition',
  'runtime_unavailable', 'storage_failure', 'workstream_not_found', 'run_not_found',
  'cross_workstream_reference', 'run_not_running'
]);

function failure(code, retryable = false, details) {
  return { error: { code, retryable, ...(details ? { details } : {}) } };
}

function dataFrom(result) {
  if (result?.ok === true) return result.data;
  return null;
}

function gatewayFailure(result) {
  const code = SAFE_GATEWAY_CODES.has(result?.error?.code) ? result.error.code : 'storage_failure';
  const currentVersion = result?.error?.details?.currentVersion;
  return failure(code, result?.error?.retryable === true, Number.isInteger(currentVersion) ? { currentVersion } : undefined);
}

function sanitizeToolResult(value) {
  if (!value || typeof value !== 'object') return {};
  const boundedString = (item, max = 200) => typeof item === 'string' && item.trim() && item.length <= max ? item : undefined;
  const result = {
    ...(boundedString(value.toolName, 100) ? { toolName: value.toolName } : {}),
    ...(boundedString(value.code, 100) ? { code: value.code } : {}),
    ...(boundedString(value.auditId) ? { auditId: value.auditId } : {}),
    ...(boundedString(value.entityId) ? { entityId: value.entityId } : {}),
    ...(Number.isInteger(value.entityVersion) && value.entityVersion >= 0 ? { entityVersion: value.entityVersion } : {}),
    ...(typeof value.confirmationRequired === 'boolean' ? { confirmationRequired: value.confirmationRequired } : {})
  };
  const requestShape = sanitizeRequestShape(value.requestShape);
  return requestShape ? { ...result, requestShape } : result;
}

function sanitizeRequestShape(value) {
  if (!value || typeof value !== 'object') return null;
  const stringList = (items) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string' && item.trim() && item.length <= 200).slice(0, 20)
    : [];
  return {
    ...(typeof value.operation === 'string' && value.operation.trim() && value.operation.length <= 100 ? { operation: value.operation } : {}),
    ...(Array.isArray(value.fields) ? { fields: stringList(value.fields) } : {}),
    ...(Array.isArray(value.changeFields) ? { changeFields: stringList(value.changeFields) } : {})
  };
}

function enrichedActions(actions) {
  return (Array.isArray(actions) ? actions : [])
    .filter((action) => OPEN_ACTION_STATUSES.has(action.status))
    .slice(0, 5)
    .map((action) => ({
      sourceType: 'margin_action', entityType: 'action', entityId: action.id,
      version: action.version ?? null, sourceSessionId: action.source_session_id ?? action.sourceSessionId ?? null,
      reason: 'open_action', content: action.title ?? action.content ?? '', status: action.status
    }));
}

export function createInteractionService({ webGateway, continuity, runtimeCoordinator, clock } = {}) {
  if (!webGateway?.internalQuery || !webGateway?.internalEvents || !continuity?.snapshot || !continuity?.plan || !runtimeCoordinator?.interact || typeof clock !== 'function') {
    throw new TypeError('invalid_interaction_service_dependencies');
  }

  async function currentEventCursor(workstreamId) {
    let cursor = 0;
    do {
      const result = await webGateway.internalEvents('event.list', { workstreamId, afterCursor: cursor, limit: 100 });
      if (result?.ok !== true) return gatewayFailure(result);
      const page = result.data;
      const nextCursor = page.nextCursor;
      if (!Number.isInteger(nextCursor) || nextCursor <= cursor) return { cursor };
      if (page.hasMore !== true) return { cursor: nextCursor };
      cursor = nextCursor;
    } while (true);
  }

  async function submit({ workstreamId, runId, message } = {}) {
    if (typeof workstreamId !== 'string' || !workstreamId.trim() || typeof runId !== 'string' || !runId.trim() ||
      typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) return failure('invalid_request');
    const boundedMessage = message.trim();
    try {
      const workstreamResult = await webGateway.internalQuery('workstream.get', { workstreamId });
      if (workstreamResult?.ok !== true) return gatewayFailure(workstreamResult);
      const workstream = workstreamResult.data;
      const runResult = await webGateway.internalQuery('run.get', { runId });
      if (runResult?.ok !== true) return gatewayFailure(runResult);
      const run = runResult.data;
      if (run.workstreamId !== workstream.id) return failure('cross_workstream_reference');
      if (run.status !== 'running') return failure('run_not_running');
      const eventCursorResult = await currentEventCursor(workstreamId);
      if (eventCursorResult?.error) return eventCursorResult;
      const eventCursor = eventCursorResult.cursor;

      const input = { projectId: workstream.id, query: boundedMessage, asOf: clock(), recentDialogue: [] };
      const snapshot = await continuity.snapshot(input);
      const plan = await continuity.plan(input, { maxItems: 12 });
      const selected = [...(Array.isArray(plan?.selected) ? plan.selected : []), ...enrichedActions(snapshot?.actions)].slice(0, 12);
      const context = {
        selected,
        excluded: Array.isArray(plan?.excluded) ? plan.excluded : [],
        digest: digestInput({ selected, excluded: Array.isArray(plan?.excluded) ? plan.excluded : [] }),
        writeRouting: routeContinuityInput(boundedMessage)
      };
      const runtimeResult = await runtimeCoordinator.interact({ run, context, message: boundedMessage });
      if (runtimeResult?.error?.code === 'runtime_unavailable') return failure('runtime_unavailable', true);

      const refreshedWorkstreamResult = await webGateway.internalQuery('workstream.get', { workstreamId });
      if (refreshedWorkstreamResult?.ok !== true) return gatewayFailure(refreshedWorkstreamResult);
      const refreshedRunResult = await webGateway.internalQuery('run.get', { runId });
      if (refreshedRunResult?.ok !== true) return gatewayFailure(refreshedRunResult);
      const refreshedWorkstream = refreshedWorkstreamResult.data;
      const refreshedRun = refreshedRunResult.data;
      if (refreshedWorkstream.id !== workstreamId || refreshedRun.id !== runId || refreshedRun.workstreamId !== workstreamId) {
        return failure('cross_workstream_reference');
      }
      const eventsResult = await webGateway.internalEvents('event.list', { workstreamId, afterCursor: eventCursor, limit: 100 });
      if (eventsResult?.ok !== true) return gatewayFailure(eventsResult);
      const events = eventsResult.data;
      return {
        message: typeof runtimeResult?.message === 'string' ? runtimeResult.message : '',
        toolResults: Array.isArray(runtimeResult?.toolResults) ? runtimeResult.toolResults.map(sanitizeToolResult) : [],
        workstream: refreshedWorkstream,
        run: refreshedRun,
        events
      };
    } catch {
      return failure('storage_failure', true);
    }
  }

  return Object.freeze({ submit });
}
