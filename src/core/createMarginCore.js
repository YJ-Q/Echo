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
  return {
    enabled: true,
    store,
    repository,
    workstreams: createWorkstreamService({ repository }),
    runs: createRunService({ repository }),
    artifacts: createArtifactService({ repository }),
    checkpoints: createCheckpointService({ repository }),
    continuity,
    tools: {
      memory_search: memory.memorySearch,
      memory_propose: memory.memoryPropose,
      state_update: state.stateUpdate,
      action_update: action.actionUpdate
    },
    planContext,
    confirmMemory: (input, trustedContext) => store.confirmMemory(input, trustedContext),
    close: () => store.close()
  };
}
