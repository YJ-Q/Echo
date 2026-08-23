import { CoreContractError } from '../core/contracts.js';
export function createArtifactService({ repository }) {
  return {
    async create(input, actor) {
      if (!input?.requestId||!input?.workstreamId||!input?.type||!input?.title||!input?.uri||!input?.contentHash) throw new CoreContractError('invalid_request','Valid Artifact input is required');
      return {ok:true,...await repository.createArtifact(input,actor)};
    },
    async list(input = {}) {
      if (!input.workstreamId || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))) throw new CoreContractError('invalid_request','Valid Artifact list input is required');
      return repository.listArtifacts(input);
    }
  };
}
