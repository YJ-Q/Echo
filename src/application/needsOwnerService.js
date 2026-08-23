import { CoreContractError } from '../core/contracts.js';

const boundedString = (value, max = 2_000) => typeof value === 'string' && value.trim() && value.length <= max;
const optionalBoundedString = (value, max = 2_000) => value === undefined || value === null || boundedString(value, max);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function validOptions(options) {
  return Array.isArray(options) && options.length <= 10 && options.every((option) =>
    plain(option) && Object.keys(option).every((key) => ['id', 'label', 'consequenceSummary'].includes(key)) &&
    boundedString(option.id, 200) && boundedString(option.label) && optionalBoundedString(option.consequenceSummary)
  );
}

function boundedList(input = {}) {
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
    throw new CoreContractError('invalid_request', 'limit must be an integer from 1 to 100');
  }
  if (input.statuses !== undefined && (!Array.isArray(input.statuses) || input.statuses.length === 0 || input.statuses.length > 20)) {
    throw new CoreContractError('invalid_request', 'statuses must be a bounded list');
  }
}

export function createNeedsOwnerService({ repository }) {
  return {
    async create(input, actor) {
      if (!boundedString(input?.requestId) || !boundedString(input?.workstreamId, 200) || !['decision', 'approval', 'input', 'conflict'].includes(input.type) ||
        !boundedString(input?.reason) || !validOptions(input.options) || !optionalBoundedString(input.consequenceSummary) ||
        !optionalBoundedString(input.contextSummary)) {
        throw new CoreContractError('invalid_request', 'Valid NeedsOwner input is required');
      }
      return { ok: true, ...await repository.createNeedsOwner(input, actor) };
    },
    async resolve(input, actor) {
      if (!boundedString(input?.requestId) || !boundedString(input?.needsOwnerId, 200) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        !optionalBoundedString(input.optionId, 200) || !optionalBoundedString(input.resolutionSummary)) {
        throw new CoreContractError('invalid_request', 'Valid NeedsOwner resolution is required');
      }
      return { ok: true, ...await repository.resolveNeedsOwner(input, actor) };
    },
    async get(id) {
      if (typeof id !== 'string' || !id.trim()) throw new CoreContractError('invalid_request', 'needsOwnerId is required');
      return repository.getNeedsOwner(id);
    },
    async list(input = {}) {
      boundedList(input);
      return repository.listNeedsOwner(input);
    }
  };
}
