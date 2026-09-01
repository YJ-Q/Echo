import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { randomUUID } from 'node:crypto';
import { MARGIN_CORE_MIGRATIONS } from './migrations/001-margin-core.js';
import { CoreContractError, digestInput } from './contracts.js';
import { rankMemoryRows } from './memoryRetrieval.js';

export async function openMarginCoreStore({
  dbPath,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
  beforeEvidenceWrite,
  embedder,
  retrievalConfig,
  transactionBusyTimeoutMs = 30_000
} = {}) {
  if (!dbPath) throw new TypeError('dbPath is required');
  if (!Number.isInteger(transactionBusyTimeoutMs) || transactionBusyTimeoutMs < 1) throw new TypeError('transactionBusyTimeoutMs must be a positive integer');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(`PRAGMA busy_timeout = ${transactionBusyTimeoutMs};`);
  let transactionTail = Promise.resolve();

  const transaction = (work) => {
    const run = transactionTail.then(async () => {
      await db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(db);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    });
    transactionTail = run.catch(() => {});
    return run;
  };

  const store = {
    db,
    clock,
    idFactory,
    beforeEvidenceWrite,
    embedder,
    close: () => db.close(),
    async migrate() {
      await db.exec(`CREATE TABLE IF NOT EXISTS margin_schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
      );`);
      for (const migration of MARGIN_CORE_MIGRATIONS) {
        const recorded = await db.get('SELECT name, checksum FROM margin_schema_migrations WHERE version = ?', migration.version);
        if (recorded) {
          if (recorded.name !== migration.name) throw new Error(`migration identity mismatch at version ${migration.version}`);
          if (recorded.checksum !== migration.checksum) throw new Error(`migration checksum mismatch at version ${migration.version}`);
          continue;
        }
        await db.exec('BEGIN IMMEDIATE');
        try {
          await db.exec(migration.sql);
          await db.run(
            'INSERT INTO margin_schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
            migration.version, migration.name, migration.checksum, clock()
          );
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      }
    },
    transaction,
    async getSchemaEvidence() {
      return db.all('SELECT version, name, checksum, applied_at FROM margin_schema_migrations ORDER BY version');
    },
    getProject: (id) => db.get('SELECT * FROM margin_projects WHERE id = ?', id),
    findActiveProjectByScenario: (scenario) => db.get(
      "SELECT * FROM margin_projects WHERE scenario = ? AND status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT 1",
      scenario
    ),
    findActiveTaskByProject: (projectId) => db.get(
      "SELECT * FROM margin_tasks WHERE project_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT 1",
      projectId
    ),
    async rankMemories(rows, { query, asOf, topK }) {
      if (!embedder?.embed || typeof embedder.model !== 'string' || rows.length === 0) {
        return rankMemoryRows(rows, { query, asOf, topK, retrievalConfig });
      }
      let queryVector;
      try {
        queryVector = await embedder.embed(query);
        if (!Array.isArray(queryVector) || queryVector.length === 0 || queryVector.some((value) => !Number.isFinite(value))) throw new Error('invalid_embedding');
      } catch {
        return rankMemoryRows(rows, { query, asOf, topK, retrievalConfig });
      }
      const placeholders = rows.map(() => '?').join(',');
      const vectors = await db.all(
        `SELECT memory_id, model, dimensions, vector_json FROM margin_memory_embeddings WHERE model = ? AND memory_id IN (${placeholders})`,
        embedder.model, ...rows.map((row) => row.id)
      );
      const byId = new Map(vectors.map((entry) => [entry.memory_id, entry]));
      const enriched = rows.map((row) => {
        const stored = byId.get(row.id);
        if (!stored || stored.dimensions !== queryVector.length) return row;
        try { return { ...row, embeddingModel: stored.model, embeddingVector: JSON.parse(stored.vector_json) }; } catch { return row; }
      });
      return rankMemoryRows(enriched, { query, asOf, topK, queryVector, embeddingModel: embedder.model, retrievalConfig });
    },
    getTask: (id) => db.get('SELECT * FROM margin_tasks WHERE id = ?', id),
    async getContinuitySnapshot({ projectId, query, asOf, memoryTopK = 5, recentDialogue = [] } = {}) {
      if (!projectId || typeof query !== 'string' || !asOf) {
        throw new CoreContractError('invalid_request', 'projectId, query, and asOf are required');
      }
      if (!Number.isInteger(memoryTopK) || memoryTopK < 1) {
        throw new CoreContractError('invalid_request', 'memoryTopK must be a positive integer');
      }
      if (!Array.isArray(recentDialogue)) {
        throw new CoreContractError('invalid_request', 'recentDialogue must be an array');
      }
      for (const dialogue of recentDialogue) {
        if (!dialogue || typeof dialogue !== 'object' || !dialogue.projectId) {
          throw new CoreContractError('invalid_request', 'recentDialogue entries require projectId');
        }
        if (dialogue.projectId !== projectId) {
          throw new CoreContractError('cross_project_reference', 'Dialogue belongs to another project');
        }
      }

      const project = await db.get(
        "SELECT * FROM margin_projects WHERE id = ? AND status NOT IN ('completed','archived') AND workstream_status <> 'completed' AND deleted_at IS NULL",
        projectId
      );
      if (!project) throw new CoreContractError('project_not_found', 'Project not found');

      const [activeTask, decisions, memoryRows] = await Promise.all([
        db.get(
          "SELECT * FROM margin_tasks WHERE project_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT 1",
          projectId
        ),
        db.all(
          `SELECT * FROM margin_decisions
           WHERE project_id = ? AND status = 'confirmed' AND superseded_by IS NULL AND effective_at <= ?
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY updated_at DESC, id ASC`,
          projectId, asOf, asOf
        ),
        db.all(
          `SELECT * FROM margin_memories
           WHERE project_id = ? AND confirmation_status = 'confirmed' AND archived_at IS NULL AND deleted_at IS NULL
             AND superseded_by IS NULL AND valid_from <= ? AND (expires_at IS NULL OR expires_at > ?)`,
          projectId, asOf, asOf
        )
      ]);

      return {
        project,
        activeTask,
        decisions,
        memories: await store.rankMemories(memoryRows, { query, asOf, topK: memoryTopK }),
        recentDialogue: recentDialogue.map((turn) => ({ ...turn }))
      };
    }
  };

  async function writeEvidence(tx, { entityType, entityId, projectId, eventType, entityVersion, operation }, context) {
    if (beforeEvidenceWrite) await beforeEvidenceWrite({ entityType, entityId, eventType });
    const now = clock();
    const auditId = context.auditId || idFactory('audit');
    await tx.run(
      `INSERT INTO margin_events
       (id, entity_type, entity_id, project_id, event_type, entity_version, payload, source_session_id, source_event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      idFactory('event'), entityType, entityId, projectId, eventType, entityVersion,
      context.sourceSessionId, context.sourceEventId, now
    );
    await tx.run(
      `INSERT INTO margin_audit_log
       (id, operation, request_id, actor_type, project_id, entity_type, entity_id, permission_decision, result_code, input_digest, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'allowed', ?, '{}', ?)`,
      auditId, operation, context.requestId, context.actorType, projectId, entityType, entityId,
      context.permissionDecision, context.inputDigest, now
    );
    return auditId;
  }

  function legacyWorkstreamTitle(input = {}) {
    for (const candidate of [input.title, input.goal]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 2_000);
    }
    throw new CoreContractError('invalid_request', 'Project title or goal is required');
  }

  store.createProject = (input, context) => store.transaction(async (tx) => {
    const now = clock();
    const id = idFactory('project');
    const title = legacyWorkstreamTitle(input);
    await tx.run(
      `INSERT INTO margin_projects
       (id, scenario, goal, phase, status, version, source_session_id, source_event_id, created_at, updated_at, deleted_at, title)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?)`,
      id, input.scenario, input.goal, input.phase, input.status || 'active',
      context.sourceSessionId, context.sourceEventId, now, now, title
    );
    await writeEvidence(tx, { entityType: 'project', entityId: id, projectId: id, eventType: 'created', entityVersion: 1, operation: 'create_project' }, context);
    return tx.get('SELECT * FROM margin_projects WHERE id = ?', id);
  });

  store.createTask = (input, context) => store.transaction(async (tx) => {
    const project = await tx.get('SELECT id FROM margin_projects WHERE id = ? AND deleted_at IS NULL', input.projectId);
    if (!project) throw new CoreContractError('project_not_found', 'Project not found');
    const now = clock();
    const id = idFactory('task');
    await tx.run(
      `INSERT INTO margin_tasks
       (id, project_id, title, current_step, blocker, completion_condition, status, version, source_session_id, source_event_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
      id, input.projectId, input.title, input.currentStep, input.blocker || null, input.completionCondition,
      input.status || 'pending', context.sourceSessionId, context.sourceEventId, now, now
    );
    await writeEvidence(tx, { entityType: 'task', entityId: id, projectId: input.projectId, eventType: 'created', entityVersion: 1, operation: 'create_task' }, context);
    return tx.get('SELECT * FROM margin_tasks WHERE id = ?', id);
  });

  store.updateProject = (id, changes, expectedVersion, context) => store.transaction(async (tx) => {
    const current = await tx.get('SELECT * FROM margin_projects WHERE id = ? AND deleted_at IS NULL', id);
    if (!current) throw new CoreContractError('project_not_found', 'Project not found');
    if (current.version !== expectedVersion) {
      const error = new CoreContractError('version_conflict', 'Project version conflict');
      error.details = { expected: expectedVersion, actual: current.version };
      throw error;
    }
    const next = { goal: changes.goal ?? current.goal, phase: changes.phase ?? current.phase, status: changes.status ?? current.status };
    await tx.run('UPDATE margin_projects SET goal=?, phase=?, status=?, version=version+1, updated_at=?, source_session_id=?, source_event_id=? WHERE id=?',
      next.goal, next.phase, next.status, clock(), context.sourceSessionId, context.sourceEventId, id);
    await writeEvidence(tx, { entityType: 'project', entityId: id, projectId: id, eventType: 'updated', entityVersion: current.version + 1, operation: 'update_project' }, context);
    return tx.get('SELECT * FROM margin_projects WHERE id = ?', id);
  });

  store.updateTask = (id, changes, expectedVersion, context) => store.transaction(async (tx) => {
    const current = await tx.get('SELECT * FROM margin_tasks WHERE id = ? AND deleted_at IS NULL', id);
    if (!current) throw new CoreContractError('task_not_found', 'Task not found');
    if (changes.projectId && changes.projectId !== current.project_id) throw new CoreContractError('cross_project_reference', 'Task belongs to another project');
    if (current.version !== expectedVersion) throw new CoreContractError('version_conflict', 'Task version conflict');
    const next = {
      title: changes.title ?? current.title, currentStep: changes.currentStep ?? current.current_step,
      blocker: changes.blocker === undefined ? current.blocker : changes.blocker,
      completionCondition: changes.completionCondition ?? current.completion_condition,
      status: changes.status ?? current.status
    };
    await tx.run('UPDATE margin_tasks SET title=?, current_step=?, blocker=?, completion_condition=?, status=?, version=version+1, updated_at=?, source_session_id=?, source_event_id=? WHERE id=?',
      next.title, next.currentStep, next.blocker, next.completionCondition, next.status, clock(), context.sourceSessionId, context.sourceEventId, id);
    const eventType = next.status === 'completed' ? 'completed' : 'updated';
    await writeEvidence(tx, { entityType: 'task', entityId: id, projectId: current.project_id, eventType, entityVersion: current.version + 1, operation: 'update_task' }, context);
    return tx.get('SELECT * FROM margin_tasks WHERE id = ?', id);
  });

  store.confirmMemory = async ({ memoryId, expectedVersion } = {}, context = {}) => {
    const evidence = context.trustedConfirmation;
    if (!memoryId || !Number.isInteger(expectedVersion) || !evidence ||
      evidence.action !== 'confirm_memory' || evidence.memoryId !== memoryId ||
      evidence.actorType !== 'user' || typeof evidence.ref !== 'string' || evidence.ref.length === 0 ||
      !['user', 'system'].includes(context.actorType) || !context.requestId || !context.sourceSessionId || !context.sourceEventId) {
      throw new CoreContractError('invalid_confirmation', 'Trusted memory confirmation is required');
    }
    let embeddingVector;
    if (embedder?.embed && typeof embedder.model === 'string') {
      const candidate = await db.get('SELECT * FROM margin_memories WHERE id = ? AND deleted_at IS NULL', memoryId);
      if (candidate && candidate.project_id === evidence.projectId && candidate.version === expectedVersion && candidate.confirmation_status === 'proposed') {
        try {
          const vector = await embedder.embed(candidate.content);
          if (Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite)) embeddingVector = vector;
        } catch {
          embeddingVector = undefined;
        }
      }
    }
    return store.transaction(async (tx) => {
    const current = await tx.get('SELECT * FROM margin_memories WHERE id = ? AND deleted_at IS NULL', memoryId);
    if (!current) throw new CoreContractError('memory_not_found', 'Memory not found');
    if (evidence.projectId !== current.project_id) {
      throw new CoreContractError('cross_project_reference', 'Confirmation belongs to another project');
    }
    if (current.version !== expectedVersion) {
      throw new CoreContractError('version_conflict', 'Memory version conflict');
    }
    if (current.confirmation_status !== 'proposed') {
      throw new CoreContractError('invalid_memory_status', 'Only proposed memories can be confirmed');
    }

    const now = clock();
    await tx.run(
      `UPDATE margin_memories
       SET confirmation_status='confirmed', version=version+1, source_session_id=?, source_event_id=?, updated_at=?
       WHERE id=?`,
      context.sourceSessionId, context.sourceEventId, now, memoryId
    );
    const memory = await tx.get('SELECT * FROM margin_memories WHERE id = ?', memoryId);
    if (embeddingVector) {
      await tx.run(
        `INSERT OR REPLACE INTO margin_memory_embeddings(memory_id, model, dimensions, vector_json, created_at) VALUES (?, ?, ?, ?, ?)`,
        memoryId, embedder.model, embeddingVector.length, JSON.stringify(embeddingVector), now
      );
    }
    await tx.run(
      `INSERT INTO margin_events VALUES (?, 'memory', ?, ?, 'updated', ?, '{}', ?, ?, ?)`,
      idFactory('event'), memoryId, current.project_id, memory.version, context.sourceSessionId, context.sourceEventId, now
    );
    if (beforeEvidenceWrite) await beforeEvidenceWrite({ entityType: 'memory', entityId: memoryId, eventType: 'updated' });
    const auditId = idFactory('audit');
    await tx.run(
      `INSERT INTO margin_audit_log VALUES (?, 'memory_confirm', ?, ?, ?, 'memory', ?, 'allowed', 'allowed', ?, '{}', ?)`,
      auditId, context.requestId, context.actorType, current.project_id, memoryId, digestConfirmation({ memoryId, expectedVersion, evidence }), now
    );
    return { memory, auditId };
    });
  };

  try {
    await store.migrate();
    return store;
  } catch (error) {
    await db.close();
    throw error;
  }
}

function digestConfirmation({ memoryId, expectedVersion, evidence }) {
  return digestInput({
    memoryId,
    expectedVersion,
    confirmation: {
      ref: evidence.ref,
      action: evidence.action,
      memoryId: evidence.memoryId,
      projectId: evidence.projectId,
      actorType: evidence.actorType
    }
  });
}
