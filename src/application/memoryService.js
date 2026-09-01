import { CoreContractError } from '../core/contracts.js';

export function createMemoryService({ repository, authorization, clock }) {
  function authorize(actor, capability) {
    if (authorization && authorization(actor, capability) !== true) {
      throw new CoreContractError('permission_denied', 'Not authorized for memory operation');
    }
  }

  const mutate = async (method, input, actor) => {
    authorize(actor, `memory:${method.replace('Memory', '').toLowerCase()}`);
    return repository[method](input, actor);
  };

  return Object.freeze({
    confirm: (input, actor) => mutate('confirmMemory', input, actor),
    correct: (input, actor) => mutate('correctMemory', input, actor),
    archive: (input, actor) => mutate('archiveMemory', input, actor),
    restore: (input, actor) => mutate('restoreMemory', input, actor),
    list: (input) => repository.listMemories(input),
    search: (input) => repository.searchMemories({ ...input, asOf: clock() })
  });
}
