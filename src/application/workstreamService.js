import { CoreContractError } from '../core/contracts.js';

export function createWorkstreamService({ repository }) {
  return {
    async create(input, actor) {
      if (!input?.requestId || !input?.title?.trim() || !input?.goal?.trim() || !['career_project','learning_research'].includes(input.scenario)) throw new CoreContractError('invalid_request','Valid workstream input is required');
      if (input.currentPlan !== undefined && (!Array.isArray(input.currentPlan) || input.currentPlan.length > 20 || input.currentPlan.some((item) => typeof item !== 'string' || !item.trim()))) throw new CoreContractError('invalid_request','currentPlan must be a bounded string list');
      if (input.nextAction !== undefined && (typeof input.nextAction !== 'string' || !input.nextAction.trim() || input.nextAction.length > 2000)) throw new CoreContractError('invalid_request','nextAction must be a bounded string');
      const result = await repository.createWorkstream(input, actor);
      return { ok: true, ...result };
    },
    async update(input, actor) {
      if (!input?.requestId || !input?.workstreamId || !Number.isInteger(input.expectedVersion) || !input?.changes || Object.keys(input.changes).length === 0) throw new CoreContractError('invalid_request','Valid Workstream update is required');
      const allowed = new Set(['goal', 'phase', 'status']);
      if (Object.keys(input.changes).some((key) => !allowed.has(key))) throw new CoreContractError('invalid_request','Unsupported Workstream field');
      return { ok: true, ...await repository.updateWorkstream(input, actor) };
    },
    get: repository.getWorkstream,
    findByScenario: repository.findWorkstreamByScenario,
    list: repository.listWorkstreams
  };
}
