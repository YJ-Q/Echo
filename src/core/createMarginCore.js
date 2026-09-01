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
import { createNeedsOwnerService } from '../application/needsOwnerService.js';
import { createMemoryService } from '../application/memoryService.js';
import { createResumeBriefService } from '../application/resumeBriefService.js';
import { createWorkstreamSwitchService } from '../application/workstreamSwitchService.js';
import { createMarginApplicationContract } from '../application/marginApplicationContract.js';
import { createContinuityService } from '../application/continuityService.js';
import { createV1ToolSet } from '../application/v1ToolSet.js';
import { validateInvocationContext } from '../contracts/validation.js';

export async function createMarginCore({ enabled = false, dbPath, clock, idFactory, beforeEvidenceWrite, embedder, retrievalConfig, transactionBusyTimeoutMs } = {}) {
  if (!enabled) return { enabled: false };
  const store = await openMarginCoreStore({ dbPath, clock, idFactory, beforeEvidenceWrite, embedder, retrievalConfig, transactionBusyTimeoutMs });
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
  const hostContextAuthority = Symbol('margin-host-context-authority');
  const bindHostActor = (actor) => {
    if (actor?.actorType !== 'user' || typeof actor?.subjectId !== 'string' || !actor.subjectId.trim()) throw new TypeError('trusted_host_actor_required');
    return { ...actor, [hostControlCapability]: true };
  };
  const bindHostContext = (context) => {
    if (context?.actor?.type !== 'user') throw new TypeError('trusted_host_user_context_required');
    const candidate = { ...context };
    Object.defineProperty(candidate, hostContextAuthority, { value: true, enumerable: true });
    return validateInvocationContext(candidate);
  };
  const toActor = (context) => {
    const actor = {
      actorType: context.actor.type,
      subjectId: context.actor.subjectId,
      sourceSessionId: context.surface.instanceId ?? context.requestId,
      sourceEventId: context.requestId,
      correlationId: context.correlationId,
      surfaceKind: context.surface.kind
    };
    return context[hostContextAuthority] === true ? bindHostActor(actor) : actor;
  };
  const runs = createRunService({ repository, authorization: (actor) => actor?.[hostControlCapability] === true });
  const artifacts = createArtifactService({ repository });
  const checkpoints = createCheckpointService({ repository });
  const needsOwner = createNeedsOwnerService({ repository });
  const memories = createMemoryService({ repository, authorization: (actor) => actor?.[hostControlCapability] === true, clock: store.clock });
  const resumeBriefs = createResumeBriefService({ repository, memories, clock: store.clock });
  const workstreamSwitch = createWorkstreamSwitchService({ repository, runs, resumeBriefs, authorization: (actor) => actor?.[hostControlCapability] === true });
  const services = { workstreams, runs, artifacts, checkpoints, needsOwner, memories, resumeBriefs, workstreamSwitch };
  return {
    enabled: true,
    store,
    repository,
    workstreams,
    runs,
    bindHostActor,
    bindHostContext,
    artifacts,
    checkpoints,
    needsOwner,
    createApplicationContract: ({ runtimeControl, authorizeContext } = {}) => createMarginApplicationContract({
      services, repository, runtimeControl, authorizeContext, toActor
    }),
    continuity,
    tools,
    v1Tools: createV1ToolSet({ legacyTools: tools, workstreams }),
    planContext,
    confirmMemory: (input, trustedContext) => store.confirmMemory(input, trustedContext),
    close: () => store.close()
  };
}
