import { planContinuityContext } from './contextPlanner.js';
import { digestInput } from '../core/contracts.js';

export class ContinuityHarnessError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContinuityHarnessError';
    this.code = code;
  }
}

function assertRequired(value, code) {
  if (!value) throw new ContinuityHarnessError(code);
  return value;
}

function summarizeToolResult(toolName, result) {
  const entity = result?.data?.memory ?? result?.data;
  const auditId = result?.auditId;
  const code = result?.ok ? 'allowed' : result?.error?.code || 'tool_failed';
  return {
    toolName,
    auditId,
    code,
    entityId: entity?.id ?? null,
    entityVersion: entity?.version ?? null
  };
}

function projectInput(projectSeed) {
  if (!projectSeed?.task) {
    throw new ContinuityHarnessError('invalid_project_seed');
  }
  if (projectSeed.project) return projectSeed.project;
  const { task, recentDialogue, plannerOptions, ...project } = projectSeed;
  if (!project.scenario || !project.goal || !project.phase) {
    throw new ContinuityHarnessError('invalid_project_seed');
  }
  return project;
}

async function closeSession(session) {
  if (session?.close) await session.close();
}

export async function runContinuityHarness({
  store,
  tools,
  sessionFactory,
  projectSeed,
  continuationQuery,
  clock,
  idFactory,
  getTrustedMemoryConfirmation
} = {}) {
  assertRequired(store?.createProject, 'invalid_store');
  assertRequired(store?.getContinuitySnapshot, 'invalid_store');
  assertRequired(store?.confirmMemory, 'invalid_store');
  assertRequired(tools?.state_update, 'invalid_tools');
  assertRequired(sessionFactory, 'invalid_session_factory');
  assertRequired(typeof continuationQuery === 'string', 'invalid_continuation_query');
  assertRequired(clock, 'invalid_clock');
  assertRequired(idFactory, 'invalid_id_factory');

  const toolResults = [];
  const runId = idFactory('continuity_run');
  let sessionA;
  let sessionB;
  let sessionAClosed = false;
  try {
    sessionA = await sessionFactory({ tools, runId, role: 'session_a' });
    assertRequired(sessionA?.id, 'invalid_session');
    assertRequired(sessionA.invokeTool, 'invalid_session');

    const project = await store.createProject(projectInput(projectSeed), {
      requestId: idFactory('request'),
      actorType: 'agent',
      sourceSessionId: sessionA.id,
      sourceEventId: idFactory('event'),
      inputDigest: digestInput(projectInput(projectSeed)),
      permissionDecision: 'allowed'
    });
    const taskResult = await sessionA.invokeTool('state_update', {
      requestId: idFactory('request'),
      projectId: project.id,
      operation: 'create_task',
      task: projectSeed.task
    });
    const taskTrace = summarizeToolResult('state_update', taskResult);
    toolResults.push(taskTrace);
    if (!taskResult?.ok) throw new ContinuityHarnessError(taskTrace.code);

    let memory;
    const confirmationAuditIds = [];
    if (projectSeed.memory) {
      assertRequired(tools?.memory_propose, 'invalid_tools');
      assertRequired(getTrustedMemoryConfirmation, 'invalid_memory_confirmation');
      const memoryResult = await sessionA.invokeTool('memory_propose', {
        requestId: idFactory('request'),
        projectId: project.id,
        taskId: taskResult.data.id,
        ...projectSeed.memory
      });
      const memoryTrace = summarizeToolResult('memory_propose', memoryResult);
      toolResults.push(memoryTrace);
      if (!memoryResult?.ok) throw new ContinuityHarnessError(memoryTrace.code);
      memory = memoryResult.data.memory;
      const trustedConfirmation = await getTrustedMemoryConfirmation({ memory, project, sessionAId: sessionA.id });
      const confirmation = await store.confirmMemory({
        memoryId: memory.id,
        expectedVersion: memory.version
      }, {
        requestId: idFactory('host_confirmation_request'),
        actorType: 'system',
        sourceSessionId: trustedConfirmation?.sourceSessionId ?? 'trusted-host',
        sourceEventId: trustedConfirmation?.sourceEventId ?? idFactory('host_confirmation_event'),
        trustedConfirmation
      });
      memory = confirmation.memory;
      confirmationAuditIds.push(confirmation.auditId);
    }

    let decision;
    if (projectSeed.decision) {
      const decisionResult = await sessionA.invokeTool('state_update', {
        requestId: idFactory('request'),
        projectId: project.id,
        taskId: taskResult.data.id,
        operation: 'replace_decision',
        ...projectSeed.decision
      });
      const decisionTrace = summarizeToolResult('state_update', decisionResult);
      toolResults.push(decisionTrace);
      if (!decisionResult?.ok) throw new ContinuityHarnessError(decisionTrace.code);
      decision = decisionResult.data;
    }

    await closeSession(sessionA);
    sessionAClosed = true;

    sessionB = await sessionFactory({ tools, runId, role: 'session_b' });
    assertRequired(sessionB?.id, 'invalid_session');
    assertRequired(sessionB.receiveContext, 'invalid_session');
    if (sessionA.id === sessionB.id) throw new ContinuityHarnessError('session_identity_conflict');

    const snapshot = await store.getContinuitySnapshot({
      projectId: project.id,
      query: continuationQuery,
      asOf: clock(),
      recentDialogue: projectSeed.recentDialogue ?? []
    });
    const context = planContinuityContext(snapshot, projectSeed.plannerOptions);
    await sessionB.receiveContext(context);

    const trace = {
      runId,
      sessionAId: sessionA.id,
      sessionBId: sessionB.id,
      projectId: project.id,
      projectVersion: project.version,
      taskId: taskResult.data.id,
      taskVersion: taskResult.data.version,
      memoryId: memory?.id ?? null,
      memoryVersion: memory?.version ?? null,
      decisionId: decision?.id ?? null,
      decisionVersion: decision?.version ?? null,
      confirmationAuditIds,
      contextDigest: context.digest,
      toolResults
    };
    trace.digest = digestInput(trace);

    return {
      sessionAId: sessionA.id,
      sessionBId: sessionB.id,
      projectId: project.id,
      taskId: taskResult.data.id,
      memoryId: memory?.id ?? null,
      decisionId: decision?.id ?? null,
      context,
      trace
    };
  } finally {
    if (sessionB) await closeSession(sessionB);
    if (sessionA && !sessionAClosed) await closeSession(sessionA);
  }
}
