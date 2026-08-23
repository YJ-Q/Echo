import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const OUTPUT_LIMIT_BYTES = 32 * 1024;
const memoryType = Type.Union(['fact', 'preference', 'constraint', 'context', 'sensitive'].map(Type.Literal));
const stateOperation = Type.Union(['update_project', 'create_task', 'update_task', 'record_blocker', 'complete_task', 'replace_decision', 'revoke_decision'].map(Type.Literal));
const actionOperation = Type.Union(['create', 'activate', 'complete', 'cancel'].map(Type.Literal));
const riskLevel = Type.Union(['read_only', 'internal_write', 'external_write', 'high_risk'].map(Type.Literal));

const memorySearchParameters = Type.Object({
  requestId: Type.String(), projectId: Type.String(), taskId: Type.Optional(Type.String()), query: Type.String(),
  topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })), asOf: Type.String(),
  memoryTypes: Type.Optional(Type.Array(memoryType))
}, { additionalProperties: false });

const memoryProposeParameters = Type.Object({
  requestId: Type.String(), projectId: Type.String(), taskId: Type.Optional(Type.String()), content: Type.String(),
  memoryType, confidence: Type.Number({ minimum: 0, maximum: 1 }), validFrom: Type.String(),
  expiresAt: Type.Optional(Type.String()), durableIntent: Type.Boolean()
}, { additionalProperties: false });

const stateUpdateParameters = Type.Object({
  requestId: Type.String(), projectId: Type.String(), operation: stateOperation, taskId: Type.Optional(Type.String()),
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })), blocker: Type.Optional(Type.String()),
  changes: Type.Optional(Type.Object({
    goal: Type.Optional(Type.String()), phase: Type.Optional(Type.String()), status: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()), currentStep: Type.Optional(Type.String()), blocker: Type.Optional(Type.String()),
    completionCondition: Type.Optional(Type.String())
  }, { additionalProperties: false })),
  task: Type.Optional(Type.Object({
    title: Type.Optional(Type.String()), currentStep: Type.Optional(Type.String()), blocker: Type.Optional(Type.String()),
    completionCondition: Type.Optional(Type.String()), status: Type.Optional(Type.String())
  }, { additionalProperties: false })),
  decisionKey: Type.Optional(Type.String()), content: Type.Optional(Type.String()), effectiveAt: Type.Optional(Type.String()),
  expiresAt: Type.Optional(Type.String()), previousDecisionId: Type.Optional(Type.String()), decisionId: Type.Optional(Type.String())
}, { additionalProperties: false });

const actionUpdateParameters = Type.Object({
  requestId: Type.String(), projectId: Type.String(), operation: actionOperation, actionId: Type.Optional(Type.String()),
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })), taskId: Type.Optional(Type.String()), title: Type.Optional(Type.String()),
  detail: Type.Optional(Type.String()), riskLevel: Type.Optional(riskLevel), dueAt: Type.Optional(Type.String()),
  confirmationRef: Type.Optional(Type.String())
}, { additionalProperties: false });

function errorResult(code, auditId) {
  const payload = { ok: false, error: { code }, auditId };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    details: { ok: false, auditId, code },
    isError: true
  };
}

function contentFreeRequestShape(params = {}) {
  return {
    operation: params.operation ?? null,
    fields: Object.keys(params).sort(),
    changeFields: Object.keys(params.changes ?? {}).sort(),
    hasTaskId: typeof params.taskId === 'string' && params.taskId.length > 0,
    hasExpectedVersion: Number.isInteger(params.expectedVersion)
  };
}

function pruneEmptyOptionals(value) {
  if (Array.isArray(value)) return value.map(pruneEmptyOptionals);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .map(([key, entry]) => [key, pruneEmptyOptionals(entry)]));
}

export function toPiToolResult(result) {
  const payload = result.ok
    ? { ok: true, data: result.data, auditId: result.auditId }
    : { ok: false, error: result.error, auditId: result.auditId };
  let text;
  try {
    text = JSON.stringify(payload);
  } catch {
    return errorResult('adapter_output_invalid', result?.auditId);
  }
  if (Buffer.byteLength(text, 'utf8') > OUTPUT_LIMIT_BYTES) {
    return errorResult('adapter_output_too_large', result.auditId);
  }
  return {
    content: [{ type: 'text', text }],
    details: { ok: result.ok, auditId: result.auditId, code: result.ok ? 'allowed' : result.error.code },
    isError: !result.ok
  };
}

function createExecutor({ toolName, handler, getInvocationContext, onToolResult, schedule }) {
  return (toolCallId, params) => schedule(async () => {
    try {
      const cleanParams = pruneEmptyOptionals(params);
      const trusted = await getInvocationContext({ toolName, toolCallId });
      if (trusted?.projectId && cleanParams.projectId !== trusted.projectId) {
        const denied = errorResult('cross_project_reference');
        onToolResult?.({ toolName, code: 'cross_project_reference', auditId: undefined });
        return denied;
      }
      const input = {
        ...cleanParams,
        requestId: trusted?.requestId ?? cleanParams.requestId ?? toolCallId,
        sourceSessionId: trusted?.sourceSessionId,
        sourceEventId: trusted?.sourceEventId ?? toolCallId
      };
      const context = trusted ? {
        actorType: trusted.actorType,
        permissions: trusted.permissions,
        confirmations: trusted.confirmations ?? []
      } : { actorType: 'agent', permissions: {}, confirmations: [] };
      const coreResult = await handler(input, context);
      const result = toPiToolResult(coreResult);
      const entity = coreResult?.data?.memory;
      onToolResult?.({
        toolName, code: result.details.code, auditId: result.details.auditId,
        ...(entity?.id ? { entityId: entity.id, entityVersion: entity.version } : {}),
        ...(coreResult?.data?.confirmationRequired === true ? { confirmationRequired: true } : {}),
        ...(result.details.code !== 'allowed' ? { requestShape: contentFreeRequestShape(cleanParams) } : {})
      });
      return result;
    } catch {
      const failed = errorResult('adapter_execution_failed');
      onToolResult?.({ toolName, code: 'adapter_execution_failed', auditId: undefined });
      return failed;
    }
  });
}

export function createMarginPiExtension({ tools, getInvocationContext, onToolResult }) {
  let executionTail = Promise.resolve();
  const schedule = (work) => {
    const result = executionTail.then(work, work);
    executionTail = result.then(() => undefined, () => undefined);
    return result;
  };
  return async (pi) => {
    pi.registerTool(defineTool({
      name: 'memory_search', label: 'Margin Memory Search', description: 'Search confirmed Margin memories for a project.',
      parameters: memorySearchParameters,
      execute: createExecutor({ toolName: 'memory_search', handler: tools.memory_search, getInvocationContext, onToolResult, schedule })
    }));
    pi.registerTool(defineTool({
      name: 'memory_propose', label: 'Margin Memory Propose', description: 'Propose a durable Margin memory for review.',
      parameters: memoryProposeParameters,
      execute: createExecutor({ toolName: 'memory_propose', handler: tools.memory_propose, getInvocationContext, onToolResult, schedule })
    }));
    pi.registerTool(defineTool({
      name: 'state_update', label: 'Margin State Update', description: 'Apply a governed state update. update_task requires taskId, expectedVersion, and non-empty changes using only title, currentStep, blocker, completionCondition, or status. update_project requires expectedVersion and non-empty changes using only goal, phase, or status. create_task requires task.',
      parameters: stateUpdateParameters,
      execute: createExecutor({ toolName: 'state_update', handler: tools.state_update, getInvocationContext, onToolResult, schedule })
    }));
    pi.registerTool(defineTool({
      name: 'action_update', label: 'Margin Action Update', description: 'Create or transition a governed Margin action.',
      parameters: actionUpdateParameters,
      execute: createExecutor({ toolName: 'action_update', handler: tools.action_update, getInvocationContext, onToolResult, schedule })
    }));
  };
}
