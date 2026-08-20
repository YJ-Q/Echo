import { openMarginCoreStore } from './marginCoreStore.js';
import { createMemoryTools } from './tools/memoryTools.js';
import { createStateTool } from './tools/stateTool.js';
import { createActionTool } from './tools/actionTool.js';

export async function createMarginCore({ enabled = false, dbPath, clock, idFactory, beforeEvidenceWrite } = {}) {
  if (!enabled) return { enabled: false };
  const store = await openMarginCoreStore({ dbPath, clock, idFactory, beforeEvidenceWrite });
  const memory = createMemoryTools({ store });
  const state = createStateTool({ store });
  const action = createActionTool({ store });
  return {
    enabled: true,
    store,
    tools: {
      memory_search: memory.memorySearch,
      memory_propose: memory.memoryPropose,
      state_update: state.stateUpdate,
      action_update: action.actionUpdate
    },
    close: () => store.close()
  };
}
