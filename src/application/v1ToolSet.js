import { fail } from '../core/contracts.js';

export function createV1ToolSet({ legacyTools, workstreams }) {
  return {
    ...legacyTools,
    async state_update(input, context = {}) {
      if (input?.operation === 'update_project') {
        try {
          return await workstreams.update({
            requestId: input.requestId, workstreamId: input.projectId,
            expectedVersion: input.expectedVersion, changes: input.changes
          }, {
            actorType: context.actorType, sourceSessionId: input.sourceSessionId,
            sourceEventId: input.sourceEventId
          });
        } catch (error) {
          return fail(error?.code ?? 'storage_failure', { retryable: !error?.code });
        }
      }
      if (['replace_decision', 'revoke_decision'].includes(input?.operation)) {
        return legacyTools.state_update(input, context);
      }
      return legacyTools.state_update({ ...input, operation: 'unsupported_v1_task_operation' }, context);
    }
  };
}
