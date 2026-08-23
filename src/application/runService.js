import { CoreContractError } from '../core/contracts.js';

export function createRunService({ repository }) {
  return {
    async create(input, actor) {
      if (!input?.requestId || !input?.workstreamId || !input?.scope?.trim() || !input?.runtimeKind) throw new CoreContractError('invalid_request','Valid Run input is required');
      return { ok: true, ...await repository.createRun(input, actor) };
    },
    get: repository.getRun
  };
}
