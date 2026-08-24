import { digestInput } from '../core/contracts.js';
import { routeContinuityInput } from '../continuity/memoryWriteRouter.js';

const MAX_MESSAGE_LENGTH = 2_000;
const OPEN_ACTION_STATUSES = new Set(['pending', 'active', 'in_progress', 'blocked', 'waiting']);
const TOOL_RESULT_FIELDS = Object.freeze([
  'toolName', 'code', 'auditId', 'entityId', 'entityVersion', 'confirmationRequired', 'requestShape'
]);

function failure(code, retryable = false) {
  return { error: { code, retryable } };
}

function dataFrom(result) {
  if (result?.ok === true) return result.data;
  return null;
}

function sanitizeToolResult(value) {
  if (!value || typeof value !== 'object') return {};
  const result = Object.fromEntries(TOOL_RESULT_FIELDS.filter((field) => field !== 'requestShape')
    .filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));
  const requestShape = sanitizeRequestShape(value.requestShape);
  return requestShape ? { ...result, requestShape } : result;
}

function sanitizeRequestShape(value) {
  if (!value || typeof value !== 'object') return null;
  const stringList = (items) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string' && item.length <= 2_000).slice(0, 20)
    : [];
  return {
    ...(typeof value.operation === 'string' && value.operation.length <= 2_000 ? { operation: value.operation } : {}),
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
      const page = dataFrom(await webGateway.internalEvents('event.list', { workstreamId, afterCursor: cursor, limit: 100 }));
      if (!page) throw new Error('event_cursor_unavailable');
      const nextCursor = page.nextCursor;
      if (!Number.isInteger(nextCursor) || nextCursor <= cursor) return cursor;
      if (page.hasMore !== true) return nextCursor;
      cursor = nextCursor;
    } while (true);
  }

  async function submit({ workstreamId, runId, message } = {}) {
    if (typeof workstreamId !== 'string' || !workstreamId.trim() || typeof runId !== 'string' || !runId.trim() ||
      typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) return failure('invalid_request');
    const boundedMessage = message.trim();
    try {
      const workstream = dataFrom(await webGateway.internalQuery('workstream.get', { workstreamId }));
      if (!workstream) return failure('not_found');
      const run = dataFrom(await webGateway.internalQuery('run.get', { runId }));
      if (!run) return failure('not_found');
      if (run.workstreamId !== workstream.id) return failure('cross_workstream_reference');
      if (run.status !== 'running') return failure('run_not_running');
      const eventCursor = await currentEventCursor(workstreamId);

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

      const refreshedWorkstream = dataFrom(await webGateway.internalQuery('workstream.get', { workstreamId }));
      const refreshedRun = dataFrom(await webGateway.internalQuery('run.get', { runId }));
      const events = dataFrom(await webGateway.internalEvents('event.list', { workstreamId, afterCursor: eventCursor, limit: 100 }));
      if (!refreshedWorkstream || !refreshedRun || !events) return failure('not_found');
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
