import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { randomUUID } from 'node:crypto';
import { MARGIN_CORE_MIGRATIONS } from './migrations/001-margin-core.js';
import { CoreContractError } from './contracts.js';

function tokens(value) {
  return new Set(String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

function overlap(query, content) {
  const queryTokens = tokens(query);
  const contentTokens = tokens(content);
  if (queryTokens.size === 0) return 0;
  let matches = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
}

function rankMemories(rows, { query, asOf, topK }) {
  return rows.map((row) => {
    const lexicalOverlap = overlap(query, row.content);
    const ageDays = Math.max(0, (new Date(asOf) - new Date(row.updated_at)) / 86400000);
    const recencyBucket = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.5 : 0;
    return { row, lexicalOverlap, score: lexicalOverlap * 0.6 + row.confidence * 0.3 + recencyBucket * 0.1 };
  }).filter((entry) => entry.lexicalOverlap > 0)
    .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at) || a.row.id.localeCompare(b.row.id))
    .slice(0, topK)
    .map(({ row, score }) => ({ ...row, score: Number(score.toFixed(6)) }));
}

export async function openMarginCoreStore({
  dbPath,
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
  beforeEvidenceWrite
} = {}) {
  if (!dbPath) throw new TypeError('dbPath is required');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');

  const store = {
    db,
    clock,
    idFactory,
    beforeEvidenceWrite,
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
    async transaction(work) {
      await db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(db);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
    async getSchemaEvidence() {
      return db.all('SELECT version, name, checksum, applied_at FROM margin_schema_migrations ORDER BY version');
    },
    getProject: (id) => db.get('SELECT * FROM margin_projects WHERE id = ?', id),
    getTask: (id) => db.get('SELECT * FROM margin_tasks WHERE id = ?', id),
    async getContinuitySnapshot({ projectId, query, asOf, memoryTopK = 5, recentDialogue = [] } = {}) {
      if (!projectId || typeof query !== 'string' || !asOf) {
        throw new CoreContractError('invalid_request', 'projectId, query, and asOf are required');
      }
      if (!Number.isInteger(memoryTopK) || memoryTopK < 1 || memoryTopK > 10) {
        throw new CoreContractError('invalid_request', 'memoryTopK must be between 1 and 10');
      }
      if (!Array.isArray(recentDialogue)) {
        throw new CoreContractError('invalid_request', 'recentDialogue must be an array');
      }

      const project = await db.get(
        "SELECT * FROM margin_projects WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
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
           WHERE project_id = ? AND confirmation_status = 'confirmed' AND deleted_at IS NULL
             AND superseded_by IS NULL AND valid_from <= ? AND (expires_at IS NULL OR expires_at > ?)`,
          projectId, asOf, asOf
        )
      ]);

      return {
        project,
        activeTask,
        decisions,
        memories: rankMemories(memoryRows, { query, asOf, topK: memoryTopK }),
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

  store.createProject = (input, context) => store.transaction(async (tx) => {
    const now = clock();
    const id = idFactory('project');
    await tx.run(
      `INSERT INTO margin_projects
       (id, scenario, goal, phase, status, version, source_session_id, source_event_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
      id, input.scenario, input.goal, input.phase, input.status || 'active',
      context.sourceSessionId, context.sourceEventId, now, now
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

  try {
    await store.migrate();
    return store;
  } catch (error) {
    await db.close();
    throw error;
  }
}
