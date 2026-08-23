import { CoreContractError } from '../core/contracts.js';

export function createWorkstreamService({ repository }) {
  return {
    async create(input, actor) {
      if (!input?.requestId || !input?.title?.trim() || !input?.goal?.trim() || !['career_project','learning_research'].includes(input.scenario)) throw new CoreContractError('invalid_request','Valid workstream input is required');
      const result = await repository.createWorkstream(input, actor);
      return { ok: true, ...result };
    },
    get: repository.getWorkstream,
    list: repository.listWorkstreams
  };
}
