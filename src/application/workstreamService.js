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
      const allowed = new Set(['goal', 'phase', 'status', 'priority', 'currentState', 'currentPlan', 'nextAction', 'autonomyLevel', 'workspacePath']);
      if (Object.keys(input.changes).some((key) => !allowed.has(key))) throw new CoreContractError('invalid_request','Unsupported Workstream field');
      if (input.changes.currentPlan !== undefined && (!Array.isArray(input.changes.currentPlan) || input.changes.currentPlan.length > 20 || input.changes.currentPlan.some((item) => typeof item !== 'string' || !item.trim()))) throw new CoreContractError('invalid_request','currentPlan must be a bounded string list');
      if (input.changes.nextAction !== undefined && input.changes.nextAction !== null && (typeof input.changes.nextAction !== 'string' || !input.changes.nextAction.trim() || input.changes.nextAction.length > 2000)) throw new CoreContractError('invalid_request','nextAction must be a bounded string');
      if (input.changes.priority !== undefined && (!Number.isInteger(input.changes.priority) || input.changes.priority < 0)) throw new CoreContractError('invalid_request','priority must be a non-negative integer');
      if (input.changes.autonomyLevel !== undefined && (!Number.isInteger(input.changes.autonomyLevel) || input.changes.autonomyLevel < 0)) throw new CoreContractError('invalid_request','autonomyLevel must be a non-negative integer');
      return { ok: true, ...await repository.updateWorkstream(input, actor) };
    },
    async get(id) {
      if (typeof id !== 'string' || !id.trim()) throw new CoreContractError('invalid_request','workstreamId is required');
      return repository.getWorkstream(id);
    },
    findByScenario: repository.findWorkstreamByScenario,
    async list(input) {
      if (input === undefined) return repository.listWorkstreams();
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new CoreContractError('invalid_request','limit must be an integer from 1 to 100');
      return repository.listWorkstreamsPage(input);
    }
  };
}
