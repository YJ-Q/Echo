import { CoreContractError, digestInput } from '../core/contracts.js';

function pauseRequestId(input) {
  return `switch_pause_${digestInput({
    requestId: input.requestId,
    sourceRunId: input.sourceRunId,
    targetWorkstreamId: input.targetWorkstreamId
  }).slice(0, 48)}`;
}

export function createWorkstreamSwitchService({ repository, runs, resumeBriefs, authorization }) {
  function authorize(actor) {
    if (authorization && authorization(actor) !== true) {
      throw new CoreContractError('permission_denied', 'Not authorized for workstream switch');
    }
  }

  return Object.freeze({
    async switch(input, actor, runtimeControl) {
      authorize(actor);
      const replay = await repository.findSwitchReplay(input, actor);
      if (replay) {
        const sourceRun = await repository.getRun(replay.sourceRunId);
        const targetBrief = await resumeBriefs.get({ workstreamId: input.targetWorkstreamId });
        return { sourceRun, targetBrief };
      }
      const sourceRun = await repository.getRun(input.sourceRunId);
      if (!sourceRun || sourceRun.workstream_id !== input.sourceWorkstreamId) {
        throw new CoreContractError('cross_workstream_reference', 'Source Run does not belong to source Workstream');
      }
      const target = await repository.getWorkstream(input.targetWorkstreamId);
      if (!target) throw new CoreContractError('not_found', 'Target Workstream not found');
      const paused = await runs.pause({
        requestId: pauseRequestId(input),
        runId: input.sourceRunId,
        expectedVersion: input.expectedVersion
      }, actor, runtimeControl);
      await repository.recordSwitchResult(input, actor, paused.data.id);
      const targetBrief = await resumeBriefs.get({ workstreamId: input.targetWorkstreamId });
      return { sourceRun: paused.data, targetBrief };
    }
  });
}
