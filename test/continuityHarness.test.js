import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarginCoreTestDb } from './helpers/marginCoreTestDb.js';
import { createStateTool } from '../src/core/tools/stateTool.js';
import { createMemoryTools } from '../src/core/tools/memoryTools.js';
import { digestInput } from '../src/core/contracts.js';
import { runContinuityHarness } from '../src/continuity/continuityHarness.js';

const asOf = '2026-08-20T00:00:00.000Z';

function projectSeed() {
  return {
    scenario: 'learning_research',
    goal: 'finish the resume review',
    phase: 'review',
    task: { title: 'Review resume', currentStep: 'continue the review', completionCondition: 'review complete', status: 'active' }
  };
}

function createFakeSessionFactory({ tools, permissions = { stateWrite: true, memoryPropose: true }, receiveContext } = {}) {
  const sessions = [];
  let next = 0;
  const sessionFactory = () => {
    const session = {
      id: `session-${String.fromCharCode(65 + next++)}`,
      contexts: [],
      closed: false,
      async invokeTool(name, input) {
        return tools[name](
          { ...input, sourceSessionId: session.id, sourceEventId: `event-${session.id}` },
          { actorType: 'agent', permissions, confirmations: [] }
        );
      },
      async receiveContext(plan) {
        if (receiveContext) await receiveContext(plan, session);
        session.contexts.push(plan);
      },
      async close() {
        session.closed = true;
      }
    };
    sessions.push(session);
    return session;
  };
  return { sessionFactory, sessions };
}

async function setup(t) {
  let nextId = 0;
  const fixture = await createMarginCoreTestDb({
    clock: () => asOf,
    idFactory: (prefix) => `${prefix}-${++nextId}`
  });
  t.after(() => fixture.cleanup());
  return {
    fixture,
    tools: {
      state_update: createStateTool({ store: fixture.store }).stateUpdate,
      memory_search: createMemoryTools({ store: fixture.store }).memorySearch,
      memory_propose: createMemoryTools({ store: fixture.store }).memoryPropose
    },
    clock: () => asOf,
    idFactory: (prefix) => `${prefix}-${++nextId}`
  };
}

test('hands deterministic Session A state to a distinct Session B without recalling absent memory', async (t) => {
  const { fixture, tools, clock, idFactory } = await setup(t);
  const fake = createFakeSessionFactory({ tools });

  const result = await runContinuityHarness({
    store: fixture.store,
    tools,
    sessionFactory: fake.sessionFactory,
    projectSeed: projectSeed(),
    continuationQuery: 'continue the resume review',
    clock,
    idFactory
  });

  assert.notEqual(result.sessionAId, result.sessionBId);
  assert.equal((await fixture.store.getProject(result.projectId)).source_session_id, result.sessionAId);
  assert.equal((await fixture.store.getTask(result.taskId)).source_session_id, result.sessionAId);
  assert.deepEqual(result.context.selected.map((item) => item.sourceType), ['margin_project', 'margin_task']);
  assert.deepEqual(result.context.excluded, []);
  assert.deepEqual(fake.sessions[1].contexts, [result.context]);
  assert.equal(result.trace.contextDigest, result.context.digest);
  const { digest, ...traceInput } = result.trace;
  assert.equal(digest, digestInput(traceInput));
  assert.equal(result.trace.toolResults.every((entry) => entry.auditId), true);
  assert.equal(JSON.stringify(result.trace).includes('finish the resume review'), false);
  assert.equal(JSON.stringify(result.trace).includes('continue the review'), false);
  assert.equal(fake.sessions.every((session) => session.closed), true);
});

test('hands a host-confirmed Session A memory and confirmed decision to Session B', async (t) => {
  const { fixture, tools, clock, idFactory } = await setup(t);
  const fake = createFakeSessionFactory({ tools });
  const seed = {
    ...projectSeed(),
    memory: { content: 'Resume only the latest draft', memoryType: 'context', confidence: 0.9, validFrom: asOf, durableIntent: true },
    decision: { decisionKey: 'resume_scope', content: 'Use the latest draft', effectiveAt: asOf }
  };

  const result = await runContinuityHarness({
    store: fixture.store, tools, sessionFactory: fake.sessionFactory, projectSeed: seed,
    continuationQuery: 'resume latest draft', clock, idFactory,
    getTrustedMemoryConfirmation: async ({ memory, project }) => ({
      ref: 'trusted-confirmation-session-a', action: 'confirm_memory', memoryId: memory.id, projectId: project.id, actorType: 'user',
      sourceSessionId: 'trusted-host-session', sourceEventId: 'trusted-host-event'
    })
  });

  assert.deepEqual(result.context.selected.map((item) => item.sourceType), [
    'margin_project', 'margin_task', 'margin_decision', 'margin_memory'
  ]);
  assert.equal(result.context.selected[2].content, 'Use the latest draft');
  assert.equal(result.context.selected[3].content, 'Resume only the latest draft');
  assert.equal(result.trace.confirmationAuditIds.length, 1);
  assert.equal((await fixture.store.db.get("SELECT confirmation_status FROM margin_memories WHERE id=?", result.memoryId)).confirmation_status, 'confirmed');
  assert.equal((await fixture.store.db.get("SELECT source_session_id FROM margin_memories WHERE id=?", result.memoryId)).source_session_id, 'trusted-host-session');
});

test('reports a stable denied tool code and closes Session A', async (t) => {
  const { fixture, tools, clock, idFactory } = await setup(t);
  const fake = createFakeSessionFactory({ tools, permissions: {} });

  await assert.rejects(
    runContinuityHarness({
      store: fixture.store, tools, sessionFactory: fake.sessionFactory, projectSeed: projectSeed(),
      continuationQuery: 'continue the resume review', clock, idFactory
    }),
    (error) => error.code === 'permission_denied'
  );
  assert.equal(fake.sessions.length, 1);
  assert.equal(fake.sessions[0].closed, true);
});

test('closes both sessions when Session B context delivery fails', async (t) => {
  const { fixture, tools, clock, idFactory } = await setup(t);
  const fake = createFakeSessionFactory({
    tools,
    receiveContext: async () => { throw new Error('delivery failed'); }
  });

  await assert.rejects(
    runContinuityHarness({
      store: fixture.store, tools, sessionFactory: fake.sessionFactory, projectSeed: projectSeed(),
      continuationQuery: 'continue the resume review', clock, idFactory
    }),
    /delivery failed/u
  );
  assert.equal(fake.sessions.length, 2);
  assert.equal(fake.sessions.every((session) => session.closed), true);
});
