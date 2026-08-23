import { openMarginCoreStore } from './marginCoreStore.js';
import { createMemoryTools } from './tools/memoryTools.js';
import { createStateTool } from './tools/stateTool.js';
import { createActionTool } from './tools/actionTool.js';
import { planContinuityContext } from '../continuity/contextPlanner.js';
import { createPersistentWorkRepository } from './persistentWorkRepository.js';
import { createWorkstreamService } from '../application/workstreamService.js';
import { createRunService } from '../application/runService.js';
import { createArtifactService } from '../application/artifactService.js';
import { createCheckpointService } from '../application/checkpointService.js';
import { createContinuityService } from '../application/continuityService.js';
import { createV1ToolSet } from '../application/v1ToolSet.js';

export async function createMarginCore({ enabled = false, dbPath, clock, idFactory, beforeEvidenceWrite, embedder, retrievalConfig } = {}) {
  if (!enabled) return { enabled: false };
  const store = await openMarginCoreStore({ dbPath, clock, idFactory, beforeEvidenceWrite, embedder, retrievalConfig });
  const memory = createMemoryTools({ store });
  const state = createStateTool({ store });
  const action = createActionTool({ store });
  const repository = createPersistentWorkRepository(store);
  const continuity = createContinuityService({ repository });
  const planContext = async (input, options) => planContinuityContext(
    await store.getContinuitySnapshot(input),
    options
  );
  const tools = {
    memory_search: memory.memorySearch,
    memory_propose: memory.memoryPropose,
    state_update: state.stateUpdate,
    action_update: action.actionUpdate
  };
  const workstreams = createWorkstreamService({ repository });
  const hostControlCapability = Symbol('margin-host-run-control');
  const bindHostActor = (actor) => {
    if (actor?.actorType !== 'user' || typeof actor?.subjectId !== 'string' || !actor.subjectId.trim()) throw new TypeError('trusted_host_actor_required');
    return { ...actor, [hostControlCapability]: true };
  };
  return {
    enabled: true,
    store,
    repository,
    workstreams,
    runs: createRunService({ repository, authorization: (actor) => actor?.[hostControlCapability] === true }),
    bindHostActor,
    artifacts: createArtifactService({ repository }),
    checkpoints: createCheckpointService({ repository }),
    continuity,
    tools,
    v1Tools: createV1ToolSet({ legacyTools: tools, workstreams }),
    planContext,
    confirmMemory: (input, trustedContext) => store.confirmMemory(input, trustedContext),
    close: () => store.close()
  };
}
