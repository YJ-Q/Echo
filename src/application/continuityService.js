import { planContinuityContext } from '../continuity/contextPlanner.js';

export function createContinuityService({ repository }) {
  return {
    snapshot: repository.getContinuitySnapshot,
    async plan(input, options) {
      return planContinuityContext(await repository.getContinuitySnapshot(input), options);
    }
  };
}
