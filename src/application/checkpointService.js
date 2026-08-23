import { CoreContractError } from '../core/contracts.js';
export function createCheckpointService({ repository }) {
  return {
    async create(input, actor) {
      if (!input?.requestId || !input?.workstreamId || !Number.isInteger(input?.stateVersion) || input.stateVersion < 0 ||
        !input?.stateDigest || (input.runId && (!Number.isInteger(input.runVersion) || input.runVersion < 1))) {
        throw new CoreContractError('invalid_request','Valid Checkpoint input is required');
      }
      return {ok:true,...await repository.createCheckpoint(input,actor)};
    },
    async latest(input) {
      if (typeof input === 'string') return repository.latestCheckpoint(input);
      if (!input?.workstreamId) throw new CoreContractError('invalid_request','workstreamId is required');
      return repository.latestCheckpointFor(input);
    }
  };
}
