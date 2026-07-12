import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { mergeProfileSignal } from '../services/profileMergeEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

let dbPromise;

export async function ensureMemoryStore() {
  await getDb();
}

export async function closeMemoryStore() {
  if (!dbPromise) {
    return;
  }

  const db = await dbPromise;
  dbPromise = undefined;
  await db.close();
}

export async function getMemories({ limit } = {}) {
  const db = await getDb();
  const rows = await db.all(
    `
      SELECT id, timestamp, user_input, echo_response, emotion, tags, memory_note, insight_note,
             salience, reinforcement_count, priority_bucket, last_accessed_at, pinned
      FROM conversations
      ORDER BY timestamp DESC
      ${typeof limit === 'number' ? 'LIMIT ?' : ''}
    `,
    ...(typeof limit === 'number' ? [limit] : [])
  );

  return rows.map(mapMemoryRow);
}

export async function addMemory(memory) {
  const db = await getDb();
  await db.run(
    `
      INSERT INTO conversations (
        timestamp, user_input, echo_response, emotion, tags, memory_note, insight_note,
        salience, reinforcement_count, priority_bucket, last_accessed_at, pinned
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    memory.timestamp,
    memory.user_input,
    memory.echo_response,
    memory.emotion,
    JSON.stringify(memory.tags || []),
    memory.memory_note || '',
    memory.insight_note || '',
    memory.salience || 0.5,
    memory.reinforcement_count || 1,
    memory.priority_bucket || 'ambient',
    memory.last_accessed_at || memory.timestamp,
    memory.pinned ? 1 : 0
  );

  return memory;
}

export async function getRelevantMemories(input, { limit = 8 } = {}) {
  const db = await getDb();
  const memories = await getMemories({ limit: 200 });
  const queryProfile = buildQueryProfile(input);
  const rankedEntries = memories
    .map((memory) => rankMemory(memory, queryProfile))
    .filter((entry) => entry.score > 0 || entry.channel_matches.length > 0)
    .sort(compareRankedMemories);
  const ranked = pickDiverseMemories(rankedEntries, limit);
  const now = new Date().toISOString();

  for (const memory of ranked) {
    await db.run(
      `
        UPDATE conversations
        SET last_accessed_at = ?,
            reinforcement_count = MIN(reinforcement_count + 1, 12),
            salience = MIN(
              CASE
                WHEN pinned = 1 THEN MAX(salience, 0.96)
                ELSE salience + 0.015
              END,
              1
            )
        WHERE id = ?
      `,
      now,
      memory.id
    );
    memory.last_accessed_at = now;
    memory.reinforcement_count = Math.min((memory.reinforcement_count || 1) + 1, 12);
    memory.salience = Math.min(
      memory.pinned ? Math.max(memory.salience || 0.5, 0.96) : (memory.salience || 0.5) + 0.015,
      1
    );
  }

  return ranked;
}

export async function updateUserState(analysis) {
  const db = await getDb();
  const now = new Date().toISOString();

  await upsertCounter(db, 'last_emotion', analysis.emotion, now);
  await upsertCounter(db, 'last_intent', analysis.intent, now);

  for (const tag of analysis.tags || []) {
    await upsertCounter(db, `tag:${tag}`, tag, now);
  }
}

export async function setMemoryPriority(id, {
  salience,
  priorityBucket,
  pinned,
  reinforcementCount
} = {}) {
  const db = await getDb();
  const memory = await db.get(
    `
      SELECT id, timestamp, user_input, echo_response, emotion, tags, memory_note, insight_note,
             salience, reinforcement_count, priority_bucket, last_accessed_at, pinned
      FROM conversations
      WHERE id = ?
    `,
    id
  );

  if (!memory) {
    return null;
  }

  await db.run(
    `
      UPDATE conversations
      SET salience = ?,
          priority_bucket = ?,
          pinned = ?,
          reinforcement_count = ?,
          last_accessed_at = ?
      WHERE id = ?
    `,
    typeof salience === 'number' ? Math.min(Math.max(salience, 0.1), 1) : memory.salience,
    priorityBucket || memory.priority_bucket,
    typeof pinned === 'boolean' ? Number(pinned) : memory.pinned,
    Number.isFinite(reinforcementCount) ? Math.min(Math.max(reinforcementCount, 1), 12) : memory.reinforcement_count,
    new Date().toISOString(),
    id
  );

  const updated = await db.get(
    `
      SELECT id, timestamp, user_input, echo_response, emotion, tags, memory_note, insight_note,
             salience, reinforcement_count, priority_bucket, last_accessed_at, pinned
      FROM conversations
      WHERE id = ?
    `,
    id
  );

  return mapMemoryRow(updated);
}

export async function getUserStates({ limit = 20 } = {}) {
  const db = await getDb();
  return db.all(
    `
      SELECT key, value, confidence, updated_at
      FROM user_states
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    limit
  );
}

export async function upsertUserProfile(key, value, confidence = 0.5, options = {}) {
  const db = await getDb();
  const existing = await db.get('SELECT value, confidence FROM user_profile WHERE key = ?', key);
  const merged = mergeProfileSignal(existing, {
    value,
    confidence,
    force: options.force
  });

  await db.run(
    `
      INSERT INTO user_profile (key, value, confidence, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `,
    key,
    merged.value,
    merged.confidence,
    new Date().toISOString()
  );
}

export async function getUserProfile() {
  const db = await getDb();
  return db.all(
    `
      SELECT key, value, confidence, updated_at
      FROM user_profile
      ORDER BY key ASC
    `
  );
}

export async function saveGrowthSuggestion(suggestion) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `
      INSERT INTO growth_suggestions
        (suggestion_key, topic, reason, experiment, source_input, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(suggestion_key) DO UPDATE SET
        topic = excluded.topic,
        reason = excluded.reason,
        experiment = excluded.experiment,
        source_input = excluded.source_input,
        updated_at = CASE
          WHEN growth_suggestions.status = 'pending' THEN excluded.updated_at
          ELSE growth_suggestions.updated_at
        END
    `,
    suggestion.key,
    suggestion.topic,
    suggestion.reason,
    suggestion.experiment,
    suggestion.source_input,
    now,
    now
  );

  return getGrowthSuggestion(suggestion.key);
}

export async function getGrowthSuggestion(key) {
  const db = await getDb();
  const row = await db.get(
    'SELECT * FROM growth_suggestions WHERE suggestion_key = ?',
    key
  );
  return mapGrowthSuggestionRow(row);
}

export async function getLatestPendingGrowthSuggestion() {
  const db = await getDb();
  const row = await db.get(`
    SELECT *
    FROM growth_suggestions
    WHERE status = 'pending'
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  return mapGrowthSuggestionRow(row);
}

export async function dismissGrowthSuggestionRecord(key) {
  const db = await getDb();
  await db.run(
    `
      UPDATE growth_suggestions
      SET status = 'dismissed', updated_at = ?
      WHERE suggestion_key = ? AND status = 'pending'
    `,
    new Date().toISOString(),
    key
  );
  return getGrowthSuggestion(key);
}

export async function confirmGrowthSuggestionRecord(key, steps) {
  const db = await getDb();
  let transactionOpen = false;

  try {
    await db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    const row = await db.get(
      'SELECT * FROM growth_suggestions WHERE suggestion_key = ?',
      key
    );

    if (!row) {
      await db.exec('ROLLBACK');
      transactionOpen = false;
      return null;
    }

    if (row.status === 'dismissed') {
      const error = new Error('growth suggestion was dismissed');
      error.status = 409;
      error.code = 'growth_suggestion_dismissed';
      throw error;
    }

    if (row.status === 'confirmed' && row.session_id) {
      const sessionRow = await db.get(
        `
          SELECT id, topic, status, current_step, steps, created_at, updated_at
          FROM learning_sessions
          WHERE id = ?
        `,
        row.session_id
      );
      await db.exec('COMMIT');
      transactionOpen = false;
      return {
        suggestion: mapGrowthSuggestionRow(row),
        session: mapLearningSessionRow(sessionRow),
        created: false
      };
    }

    const now = new Date().toISOString();
    const result = await db.run(
      `
        INSERT INTO learning_sessions
          (topic, status, current_step, steps, created_at, updated_at)
        VALUES (?, 'active', 0, ?, ?, ?)
      `,
      row.topic,
      JSON.stringify(steps),
      now,
      now
    );
    await db.run(
      `
        UPDATE growth_suggestions
        SET status = 'confirmed', session_id = ?, updated_at = ?
        WHERE suggestion_key = ?
      `,
      result.lastID,
      now,
      key
    );
    const confirmedRow = await db.get(
      'SELECT * FROM growth_suggestions WHERE suggestion_key = ?',
      key
    );
    const sessionRow = await db.get(
      `
        SELECT id, topic, status, current_step, steps, created_at, updated_at
        FROM learning_sessions
        WHERE id = ?
      `,
      result.lastID
    );
    await db.exec('COMMIT');
    transactionOpen = false;
    return {
      suggestion: mapGrowthSuggestionRow(confirmedRow),
      session: mapLearningSessionRow(sessionRow),
      created: true
    };
  } catch (error) {
    if (transactionOpen) {
      await db.exec('ROLLBACK').catch(() => {});
    }
    throw error;
  }
}

export async function createLearningSession({ topic, steps }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.run(
    `
      INSERT INTO learning_sessions
        (topic, status, current_step, steps, created_at, updated_at)
      VALUES (?, 'active', 0, ?, ?, ?)
    `,
    topic,
    JSON.stringify(steps),
    now,
    now
  );

  return getLearningSessionById(result.lastID);
}

export async function addLearningEvent({
  sessionId,
  topic,
  eventType,
  stepIndex,
  stepTitle,
  note,
  userInput
}) {
  const db = await getDb();
  const event = {
    session_id: sessionId,
    topic,
    event_type: eventType,
    step_index: typeof stepIndex === 'number' ? stepIndex : null,
    step_title: stepTitle || null,
    note: note || null,
    user_input: userInput || null,
    created_at: new Date().toISOString()
  };

  await db.run(
    `
      INSERT INTO learning_events
        (session_id, topic, event_type, step_index, step_title, note, user_input, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    event.session_id,
    event.topic,
    event.event_type,
    event.step_index,
    event.step_title,
    event.note,
    event.user_input,
    event.created_at
  );

  return event;
}

export async function getLearningEvents({ sessionId, limit = 50 } = {}) {
  const db = await getDb();
  const rows = sessionId
    ? await db.all(
      `
        SELECT id, session_id, topic, event_type, step_index, step_title, note, user_input, created_at
        FROM learning_events
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      sessionId,
      limit
    )
    : await db.all(
      `
        SELECT id, session_id, topic, event_type, step_index, step_title, note, user_input, created_at
        FROM learning_events
        ORDER BY created_at DESC
        LIMIT ?
      `,
      limit
    );

  return rows.map(mapLearningEventRow);
}

export async function getLearningSessions({ status, limit = 20 } = {}) {
  const db = await getDb();
  const rows = status
    ? await db.all(
      `
        SELECT id, topic, status, current_step, steps, created_at, updated_at
        FROM learning_sessions
        WHERE status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      status,
      limit
    )
    : await db.all(
      `
        SELECT id, topic, status, current_step, steps, created_at, updated_at
        FROM learning_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      limit
    );

  return rows.map(mapLearningSessionRow);
}

export async function getActiveLearningSession(topic) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, topic, status, current_step, steps, created_at, updated_at
      FROM learning_sessions
      WHERE topic = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    topic
  );

  return row ? mapLearningSessionRow(row) : null;
}

export async function getLatestActiveLearningSession() {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, topic, status, current_step, steps, created_at, updated_at
      FROM learning_sessions
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `
  );

  return row ? mapLearningSessionRow(row) : null;
}

export async function updateLearningStep(sessionId, stepIndex, status) {
  const db = await getDb();
  const session = await getLearningSessionById(sessionId);

  if (!session) {
    return null;
  }

  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= session.steps.length) {
    const error = new Error('learning step index is out of range');
    error.status = 400;
    error.code = 'learning_step_out_of_range';
    throw error;
  }

  const steps = session.steps.map((step, index) => ({
    ...step,
    status: index === stepIndex ? status : step.status
  }));

  const nextStep = steps.findIndex((step) => step.status !== 'done');
  const currentStep = nextStep === -1 ? steps.length - 1 : nextStep;
  const sessionStatus = nextStep === -1 ? 'completed' : 'active';

  if (sessionStatus === 'active') {
    steps[currentStep] = {
      ...steps[currentStep],
      status: steps[currentStep].status === 'pending' ? 'active' : steps[currentStep].status
    };
  }

  await db.run(
    `
      UPDATE learning_sessions
      SET status = ?, current_step = ?, steps = ?, updated_at = ?
      WHERE id = ?
    `,
    sessionStatus,
    currentStep,
    JSON.stringify(steps),
    new Date().toISOString(),
    sessionId
  );

  return getLearningSessionById(sessionId);
}

export async function updateLearningSessionStatus(sessionId, status) {
  const db = await getDb();
  const session = await getLearningSessionById(sessionId);

  if (!session) {
    return null;
  }

  await db.run(
    `
      UPDATE learning_sessions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `,
    status,
    new Date().toISOString(),
    sessionId
  );

  return getLearningSessionById(sessionId);
}

export async function saveSummary(summary) {
  const db = await getDb();
  const existing = await db.get(
    `
      SELECT id
      FROM summaries
      WHERE date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    summary.date
  );
  const createdAt = new Date().toISOString();

  if (existing) {
    await db.run(
      `
        UPDATE summaries
        SET summary = ?, emotional_trend = ?, behavioral_pattern = ?, echo_reflection = ?, created_at = ?
        WHERE id = ?
      `,
      summary.summary,
      summary.emotional_trend,
      summary.behavioral_pattern,
      summary.echo_reflection,
      createdAt,
      existing.id
    );
  } else {
    await db.run(
      `
        INSERT INTO summaries
          (date, summary, emotional_trend, behavioral_pattern, echo_reflection, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      summary.date,
      summary.summary,
      summary.emotional_trend,
      summary.behavioral_pattern,
      summary.echo_reflection,
      createdAt
    );
  }

  return summary;
}

export async function getSummaries({ limit = 7 } = {}) {
  const db = await getDb();
  return db.all(
    `
      SELECT id, date, summary, emotional_trend, behavioral_pattern, echo_reflection, created_at
      FROM summaries
      ORDER BY created_at DESC
      LIMIT ?
    `,
    limit
  );
}

export async function createAction({
  type,
  title,
  detail,
  source = 'manual',
  priority = 3,
  status = 'pending',
  dueAt = null,
  metadata = {}
}) {
  const db = await getDb();
  const existing = await db.get(
    `
      SELECT id, type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at
      FROM actions
      WHERE type = ? AND title = ? AND source = ? AND status IN ('pending', 'active')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    type,
    title,
    source
  );

  if (existing) {
    return mapActionRow(existing);
  }

  const now = new Date().toISOString();
  const result = await db.run(
    `
      INSERT INTO actions
        (type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    type,
    title,
    detail || '',
    source,
    priority,
    status,
    dueAt,
    JSON.stringify(metadata || {}),
    now,
    now
  );

  return getActionById(result.lastID);
}

export async function getActions({ status, limit = 20 } = {}) {
  const db = await getDb();
  const rows = status
    ? await db.all(
      `
        SELECT id, type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at
        FROM actions
        WHERE status = ?
        ORDER BY priority ASC, updated_at DESC, created_at DESC, id DESC
        LIMIT ?
      `,
      status,
      limit
    )
    : await db.all(
      `
        SELECT id, type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at
        FROM actions
        ORDER BY
          CASE status
            WHEN 'active' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'done' THEN 2
            WHEN 'dismissed' THEN 3
            ELSE 4
          END,
          priority ASC,
          updated_at DESC,
          created_at DESC,
          id DESC
        LIMIT ?
      `,
      limit
    );

  return rows.map(mapActionRow);
}

export async function findActionBySuggestedIdentity(identity) {
  if (!identity) {
    return null;
  }

  const db = await getDb();
  const rows = await db.all(
    `
      SELECT id, type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at
      FROM actions
      WHERE source = 'echo_state' AND status IN ('pending', 'active')
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'pending' THEN 1
          ELSE 2
        END,
        priority ASC,
        updated_at DESC,
        created_at DESC,
        id DESC
      LIMIT 100
    `
  );

  return rows
    .map(mapActionRow)
    .find((action) => action.metadata?.suggested_identity === identity) || null;
}

export async function updateActionStatus(id, status) {
  const db = await getDb();
  const action = await getActionById(id);

  if (!action) {
    return null;
  }

  await db.run(
    `
      UPDATE actions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `,
    status,
    new Date().toISOString(),
    id
  );

  return getActionById(id);
}

export async function createOperationProposal({
  scope,
  status = 'awaiting_confirmation',
  summary,
  riskLevel = 'read_only',
  operations = [],
  preview = {},
  metadata = {}
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.run(
    `
      INSERT INTO operation_proposals
        (scope, status, summary, risk_level, operations, preview, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    scope,
    status,
    summary,
    riskLevel,
    JSON.stringify(operations || []),
    JSON.stringify(preview || {}),
    JSON.stringify(metadata || {}),
    now,
    now
  );
  const proposal = await getOperationProposalById(result.lastID);

  await addOperationEvent({
    proposalId: proposal.id,
    eventType: 'proposal_created',
    scope: proposal.scope,
    riskLevel: proposal.risk_level,
    operationSummary: proposal.summary,
    payload: {
      status: proposal.status,
      operation_count: proposal.operations.length
    }
  });

  return proposal;
}

export async function getOperationProposals({ status, scope, limit = 20 } = {}) {
  const db = await getDb();
  const clauses = [];
  const values = [];

  if (status) {
    clauses.push('status = ?');
    values.push(status);
  }

  if (scope) {
    clauses.push('scope = ?');
    values.push(scope);
  }

  values.push(limit);

  const rows = await db.all(
    `
      SELECT id, scope, status, summary, risk_level, operations, preview, metadata, created_at, updated_at
      FROM operation_proposals
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT ?
    `,
    ...values
  );

  return rows.map(mapOperationProposalRow);
}

export async function getOperationProposalById(id) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, scope, status, summary, risk_level, operations, preview, metadata, created_at, updated_at
      FROM operation_proposals
      WHERE id = ?
    `,
    id
  );

  return row ? mapOperationProposalRow(row) : null;
}

export async function updateOperationProposalStatus(id, status, metadataPatch = {}) {
  const db = await getDb();
  const proposal = await getOperationProposalById(id);

  if (!proposal) {
    return null;
  }

  const metadata = {
    ...proposal.metadata,
    ...metadataPatch
  };

  await db.run(
    `
      UPDATE operation_proposals
      SET status = ?,
          metadata = ?,
          updated_at = ?
      WHERE id = ?
    `,
    status,
    JSON.stringify(metadata),
    new Date().toISOString(),
    id
  );

  return getOperationProposalById(id);
}

export async function addOperationEvent({
  proposalId,
  eventType,
  scope,
  riskLevel = 'read_only',
  operationSummary,
  payload = {}
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.run(
    `
      INSERT INTO operation_events
        (proposal_id, event_type, scope, risk_level, operation_summary, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    proposalId || null,
    eventType,
    scope,
    riskLevel,
    operationSummary || '',
    JSON.stringify(payload || {}),
    now
  );

  return getOperationEventById(result.lastID);
}

export async function getOperationEvents({ proposalId, limit = 50 } = {}) {
  const db = await getDb();
  const rows = proposalId
    ? await db.all(
      `
        SELECT id, proposal_id, event_type, scope, risk_level, operation_summary, payload, created_at
        FROM operation_events
        WHERE proposal_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      proposalId,
      limit
    )
    : await db.all(
      `
        SELECT id, proposal_id, event_type, scope, risk_level, operation_summary, payload, created_at
        FROM operation_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      limit
    );

  return rows.map(mapOperationEventRow);
}

export async function syncAchievementDefinitions(definitions = []) {
  const db = await getDb();
  const normalizedDefinitions = definitions.map((definition, index) => normalizeAchievementDefinition(definition, index));
  const keys = normalizedDefinitions.map((definition) => definition.key);
  const now = new Date().toISOString();

  await db.exec('BEGIN IMMEDIATE;');

  try {
    for (const definition of normalizedDefinitions) {
      await db.run(
        `
          INSERT INTO achievement_definitions (
            key, definition_id, group_key, group_label, title, description, locked_description,
            rarity, source_type, icon_type, palette_key, accent_color, hidden, sort_order,
            definition_json, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            definition_id = excluded.definition_id,
            group_key = excluded.group_key,
            group_label = excluded.group_label,
            title = excluded.title,
            description = excluded.description,
            locked_description = excluded.locked_description,
            rarity = excluded.rarity,
            source_type = excluded.source_type,
            icon_type = excluded.icon_type,
            palette_key = excluded.palette_key,
            accent_color = excluded.accent_color,
            hidden = excluded.hidden,
            sort_order = excluded.sort_order,
            definition_json = excluded.definition_json,
            updated_at = excluded.updated_at
        `,
        definition.key,
        definition.definition_id,
        definition.group_key,
        definition.group_label,
        definition.title,
        definition.description,
        definition.locked_description,
        definition.rarity,
        definition.source_type,
        definition.icon_type,
        definition.palette_key,
        definition.accent_color,
        definition.hidden,
        definition.sort_order,
        definition.definition_json,
        now
      );
    }

    if (keys.length > 0) {
      const placeholders = keys.map(() => '?').join(', ');
      await db.run(`DELETE FROM achievement_definitions WHERE key NOT IN (${placeholders})`, ...keys);
    } else {
      await db.run('DELETE FROM achievement_definitions');
    }

    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

export async function getAchievementDefinitions() {
  const db = await getDb();
  const rows = await db.all(
    `
      SELECT key, definition_id, group_key, group_label, title, description, locked_description,
             rarity, source_type, icon_type, palette_key, accent_color, hidden, sort_order,
             definition_json, updated_at
      FROM achievement_definitions
      ORDER BY sort_order ASC, definition_id ASC, key ASC
    `
  );

  return rows.map(mapAchievementDefinitionRow);
}

export async function getAchievementDefinitionByKey(key) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT key, definition_id, group_key, group_label, title, description, locked_description,
             rarity, source_type, icon_type, palette_key, accent_color, hidden, sort_order,
             definition_json, updated_at
      FROM achievement_definitions
      WHERE key = ?
    `,
    key
  );

  return row ? mapAchievementDefinitionRow(row) : null;
}

export async function recordAchievementUnlockCandidates(candidates = []) {
  const db = await getDb();

  for (const candidate of candidates) {
    await db.run(
      `
        INSERT INTO achievement_unlocks (
          key, source_type, source_id, unlocked_at, acknowledged_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(key) DO NOTHING
      `,
      candidate.key,
      candidate.source_type,
      candidate.source_id === undefined ? null : candidate.source_id,
      candidate.unlocked_at,
      candidate.created_at || new Date().toISOString(),
      candidate.updated_at || new Date().toISOString()
    );
  }
}

export async function getAchievementUnlocks() {
  const db = await getDb();
  const rows = await db.all(
    `
      SELECT key, source_type, source_id, unlocked_at, acknowledged_at, created_at, updated_at
      FROM achievement_unlocks
      ORDER BY unlocked_at DESC, key ASC
    `
  );

  return rows.map(mapAchievementUnlockRow);
}

export async function getAchievementUnlockByKey(key) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT key, source_type, source_id, unlocked_at, acknowledged_at, created_at, updated_at
      FROM achievement_unlocks
      WHERE key = ?
    `,
    key
  );

  return row ? mapAchievementUnlockRow(row) : null;
}

export async function acknowledgeAchievementUnlock(key) {
  const db = await getDb();
  const existing = await getAchievementUnlockByKey(key);

  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  await db.run(
    `
      UPDATE achievement_unlocks
      SET acknowledged_at = COALESCE(acknowledged_at, ?),
          updated_at = ?
      WHERE key = ?
    `,
    now,
    now,
    key
  );

  return getAchievementUnlockByKey(key);
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }

  return dbPromise;
}

async function openDatabase() {
  const { dataDir, dbPath } = getStorePaths();
  await mkdir(dataDir, { recursive: true });

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA journal_mode = WAL;');
  await migrateMemoryStoreDatabase(db);
  await importLegacyJsonIfNeeded(db);

  return db;
}

export async function migrateMemoryStoreDatabase(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_input TEXT NOT NULL,
      echo_response TEXT NOT NULL,
      emotion TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      memory_note TEXT NOT NULL DEFAULT '',
      insight_note TEXT NOT NULL DEFAULT '',
      salience REAL NOT NULL DEFAULT 0.5,
      reinforcement_count INTEGER NOT NULL DEFAULT 1,
      priority_bucket TEXT NOT NULL DEFAULT 'ambient',
      last_accessed_at TEXT,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_timestamp
      ON conversations(timestamp);

    CREATE INDEX IF NOT EXISTS idx_conversations_emotion
      ON conversations(emotion);

    CREATE TABLE IF NOT EXISTS user_states (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      emotional_trend TEXT NOT NULL,
      behavioral_pattern TEXT NOT NULL,
      echo_reflection TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learning_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      steps TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learning_sessions_status
      ON learning_sessions(status);

    CREATE INDEX IF NOT EXISTS idx_learning_sessions_topic
      ON learning_sessions(topic);

    CREATE TABLE IF NOT EXISTS growth_suggestions (
      suggestion_key TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      reason TEXT NOT NULL,
      experiment TEXT NOT NULL,
      source_input TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      session_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES learning_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_growth_suggestions_status_updated
      ON growth_suggestions(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS learning_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      topic TEXT NOT NULL,
      event_type TEXT NOT NULL,
      step_index INTEGER,
      step_title TEXT,
      note TEXT,
      user_input TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES learning_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_learning_events_session
      ON learning_events(session_id);

    CREATE INDEX IF NOT EXISTS idx_learning_events_created_at
      ON learning_events(created_at);

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      priority INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending',
      due_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_actions_status
      ON actions(status);

    CREATE INDEX IF NOT EXISTS idx_actions_priority
      ON actions(priority);

    CREATE TABLE IF NOT EXISTS operation_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_confirmation',
      summary TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'read_only',
      operations TEXT NOT NULL DEFAULT '[]',
      preview TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_operation_proposals_status
      ON operation_proposals(status);

    CREATE INDEX IF NOT EXISTS idx_operation_proposals_scope
      ON operation_proposals(scope);

    CREATE TABLE IF NOT EXISTS operation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER,
      event_type TEXT NOT NULL,
      scope TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'read_only',
      operation_summary TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES operation_proposals(id)
    );

    CREATE INDEX IF NOT EXISTS idx_operation_events_proposal
      ON operation_events(proposal_id);

    CREATE INDEX IF NOT EXISTS idx_operation_events_created_at
      ON operation_events(created_at);

    CREATE TABLE IF NOT EXISTS achievement_definitions (
      key TEXT PRIMARY KEY,
      definition_id INTEGER NOT NULL,
      group_key TEXT NOT NULL,
      group_label TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      locked_description TEXT,
      rarity TEXT NOT NULL,
      source_type TEXT NOT NULL,
      icon_type TEXT NOT NULL,
      palette_key TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      definition_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievement_unlocks (
      key TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT,
      unlocked_at TEXT NOT NULL,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked_at
      ON achievement_unlocks(unlocked_at);

    CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_acknowledged_at
      ON achievement_unlocks(acknowledged_at);
  `);

  await ensureColumn(db, 'user_profile', 'confidence', 'REAL NOT NULL DEFAULT 0.5');
  await ensureColumn(db, 'conversations', 'memory_note', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'conversations', 'insight_note', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'conversations', 'salience', 'REAL NOT NULL DEFAULT 0.5');
  await ensureColumn(db, 'conversations', 'reinforcement_count', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'conversations', 'priority_bucket', "TEXT NOT NULL DEFAULT 'ambient'");
  await ensureColumn(db, 'conversations', 'last_accessed_at', 'TEXT');
  await ensureColumn(db, 'conversations', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
}

async function importLegacyJsonIfNeeded(db) {
  const { legacyMemoryPath } = getStorePaths();
  const count = await db.get('SELECT COUNT(*) AS count FROM conversations');

  if (count.count > 0) {
    return;
  }

  try {
    const raw = await readFile(legacyMemoryPath, 'utf8');
    const memories = JSON.parse(raw);

    for (const memory of memories) {
      await db.run(
        `
          INSERT INTO conversations (
            timestamp, user_input, echo_response, emotion, tags, memory_note, insight_note,
            salience, reinforcement_count, priority_bucket, last_accessed_at, pinned
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        memory.timestamp,
        memory.user_input,
        memory.echo_response,
        memory.emotion,
        JSON.stringify(memory.tags || []),
        memory.memory_note || '',
        memory.insight_note || '',
        memory.salience || 0.5,
        memory.reinforcement_count || 1,
        memory.priority_bucket || 'ambient',
        memory.last_accessed_at || memory.timestamp,
        memory.pinned ? 1 : 0
      );
    }

    await unlink(legacyMemoryPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function upsertCounter(db, key, value, updatedAt) {
  const existing = await db.get('SELECT confidence FROM user_states WHERE key = ?', key);
  const confidence = Math.min((existing?.confidence || 0.4) + 0.1, 1);

  await db.run(
    `
      INSERT INTO user_states (key, value, confidence, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `,
    key,
    value,
    confidence,
    updatedAt
  );
}

async function ensureColumn(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  const hasColumn = columns.some((entry) => entry.name === column);

  if (!hasColumn) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function mapMemoryRow(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    user_input: row.user_input,
    echo_response: row.echo_response,
    emotion: row.emotion,
    tags: safeJsonArray(row.tags),
    memory_note: row.memory_note || '',
    insight_note: row.insight_note || '',
    salience: Number(row.salience || 0.5),
    reinforcement_count: Number(row.reinforcement_count || 1),
    priority_bucket: row.priority_bucket || 'ambient',
    last_accessed_at: row.last_accessed_at || '',
    pinned: Boolean(row.pinned)
  };
}

export async function getLearningSessionById(id) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, topic, status, current_step, steps, created_at, updated_at
      FROM learning_sessions
      WHERE id = ?
    `,
    id
  );

  return row ? mapLearningSessionRow(row) : null;
}

function mapLearningSessionRow(row) {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    current_step: row.current_step,
    steps: safeJsonArray(row.steps),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapGrowthSuggestionRow(row) {
  if (!row) return null;
  return {
    key: row.suggestion_key,
    topic: row.topic,
    reason: row.reason,
    experiment: row.experiment,
    source_input: row.source_input,
    status: row.status,
    session_id: row.session_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapLearningEventRow(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    topic: row.topic,
    event_type: row.event_type,
    step_index: row.step_index,
    step_title: row.step_title,
    note: row.note,
    user_input: row.user_input,
    created_at: row.created_at
  };
}

async function getActionById(id) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, type, title, detail, source, priority, status, due_at, metadata, created_at, updated_at
      FROM actions
      WHERE id = ?
    `,
    id
  );

  return row ? mapActionRow(row) : null;
}

export { getActionById };

function mapActionRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    detail: row.detail,
    source: row.source,
    priority: row.priority,
    status: row.status,
    due_at: row.due_at,
    metadata: safeJsonObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getOperationEventById(id) {
  const db = await getDb();
  const row = await db.get(
    `
      SELECT id, proposal_id, event_type, scope, risk_level, operation_summary, payload, created_at
      FROM operation_events
      WHERE id = ?
    `,
    id
  );

  return row ? mapOperationEventRow(row) : null;
}

function mapOperationProposalRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    status: row.status,
    summary: row.summary,
    risk_level: row.risk_level,
    operations: safeJsonArray(row.operations),
    preview: safeJsonObject(row.preview),
    metadata: safeJsonObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapOperationEventRow(row) {
  return {
    id: row.id,
    proposal_id: row.proposal_id,
    event_type: row.event_type,
    scope: row.scope,
    risk_level: row.risk_level,
    operation_summary: row.operation_summary,
    payload: safeJsonObject(row.payload),
    created_at: row.created_at
  };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeAchievementDefinition(definition, index) {
  const serializableDefinition = { ...definition };
  delete serializableDefinition.resolve;

  return {
    key: definition.key,
    definition_id: definition.id,
    group_key: definition.group_key,
    group_label: definition.group_label,
    title: definition.title,
    description: definition.description ?? null,
    locked_description: definition.locked_description ?? null,
    rarity: definition.rarity,
    source_type: definition.source_type,
    icon_type: definition.icon_type,
    palette_key: definition.palette_key,
    accent_color: definition.accent_color,
    hidden: definition.hidden ? 1 : 0,
    sort_order: index,
    definition_json: JSON.stringify(serializableDefinition)
  };
}

function mapAchievementDefinitionRow(row) {
  return {
    id: row.definition_id,
    definition_id: row.definition_id,
    key: row.key,
    group_key: row.group_key,
    group_label: row.group_label,
    title: row.title,
    description: row.description,
    locked_description: row.locked_description,
    rarity: row.rarity,
    source_type: row.source_type,
    icon_type: row.icon_type,
    palette_key: row.palette_key,
    accent_color: row.accent_color,
    hidden: Boolean(row.hidden),
    sort_order: row.sort_order,
    definition_json: safeJsonObject(row.definition_json),
    updated_at: row.updated_at
  };
}

function mapAchievementUnlockRow(row) {
  return {
    key: row.key,
    source_type: row.source_type,
    source_id: normalizeAchievementSourceId(row.source_id),
    unlocked_at: row.unlocked_at,
    acknowledged_at: row.acknowledged_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeAchievementSourceId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  if (Number.isFinite(normalized) && String(normalized) === String(value)) {
    return normalized;
  }

  return value;
}

function rankMemory(memory, queryProfile) {
  const queryTokens = queryProfile.tokens;
  const normalizedTags = new Set((memory.tags || []).map((tag) => tag.toLowerCase()));
  const textScore = scoreMemoryText(memory, queryTokens);
  const tagScore = scoreTagOverlap(normalizedTags, queryProfile.tags);
  const emotionScore = normalizedTags.has(queryProfile.emotion) || memory.emotion === queryProfile.emotion
    ? 1.3
    : 0;
  const topicScore = scoreTopicContinuity(memory, queryProfile);
  const priorityScore = computeEffectivePriority(memory);
  const recencyScore = getRecencyScore(memory.timestamp);
  const pinnedBonus = memory.pinned ? 0.8 : 0;
  const channelMatches = collectChannelMatches({
    memory,
    queryProfile,
    textScore,
    tagScore,
    emotionScore,
    topicScore,
    priorityScore,
    recencyScore
  });
  const channelScore = scoreRetrievalChannels(channelMatches);
  const score = textScore
    + tagScore
    + emotionScore
    + topicScore
    + recencyScore
    + priorityScore
    + pinnedBonus
    + channelScore;

  return {
    memory: {
      ...memory,
      retrieval: {
        score: Number(score.toFixed(3)),
        ranking_score: Number(score.toFixed(3)),
        channel_score: Number(channelScore.toFixed(3)),
        channels: channelMatches
      }
    },
    score,
    effective_priority: priorityScore,
    channel_matches: channelMatches
  };
}

function scoreRetrievalChannels(channels) {
  const weights = {
    direct_match: 1.2,
    learning_continuity: 0.9,
    core_anchor: 0.75,
    emotional_resonance: 0.45,
    recent_thread: 0.25
  };

  return channels.reduce((score, channel) => score + (weights[channel] || 0), 0);
}

function scoreMemoryText(memory, queryTokens) {
  const haystack = [
    memory.user_input,
    memory.echo_response,
    memory.memory_note,
    memory.insight_note,
    memory.emotion,
    ...(memory.tags || [])
  ].join(' ').toLowerCase();

  const textScore = queryTokens.reduce((score, token) => {
    return haystack.includes(token) ? score + tokenWeight(token, memory) : score;
  }, 0);

  return textScore > 0 ? textScore : 0;
}

function tokenize(input) {
  const normalized = input
    .toLowerCase()
    .trim();
  const wordTokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
  const cjkTokens = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/g))
    .flatMap((match) => toCjkBigrams(match[0]));

  return [...new Set([...wordTokens, ...cjkTokens, ...extractIntentTerms(normalized)])];
}

function toCjkBigrams(value) {
  const chars = [...value];
  const tokens = [];

  for (let index = 0; index < chars.length - 1; index += 1) {
    tokens.push(`${chars[index]}${chars[index + 1]}`);
  }

  return tokens;
}

function extractIntentTermsLegacy(value) {
  const terms = [];
  const mappings = [
    ['拖延', 'procrastination'],
    ['不想做', 'procrastination'],
    ['逃避', 'procrastination'],
    ['卡住', 'procrastination'],
    ['焦虑', 'anxious'],
    ['压力', 'anxious'],
    ['学习', 'learning'],
    ['想学', 'learning'],
    ['计划', 'planning'],
    ['安排', 'planning']
  ];

  for (const [needle, term] of mappings) {
    if (value.includes(needle)) {
      terms.push(needle, term);
    }
  }

  return terms;
}

function extractIntentTerms(value) {
  const terms = [];
  const mappings = [
    ['拖延', 'procrastination'],
    ['不想做', 'procrastination'],
    ['逃避', 'procrastination'],
    ['卡住', 'procrastination'],
    ['焦虑', 'anxious'],
    ['压力', 'anxious'],
    ['学习', 'learning'],
    ['想学', 'learning'],
    ['计划', 'planning'],
    ['安排', 'planning']
  ];

  for (const [needle, term] of mappings) {
    if (value.includes(needle)) {
      terms.push(needle, term);
    }
  }

  return terms;
}

function tokenWeight(token, memory) {
  if (memory.emotion === token || memory.tags?.includes(token)) {
    return 2;
  }

  return token.length >= 4 ? 1.4 : 1;
}

function buildQueryProfile(input) {
  const normalized = input.toLowerCase().trim();
  const tags = new Set(extractIntentTerms(normalized).filter((term) => {
    return ['learning', 'procrastination', 'planning', 'anxious'].includes(term);
  }));
  const emotion = inferQueryEmotion(normalized);
  const topicHints = extractTopicHints(input);

  if (topicHints.length > 0) {
    tags.add('learning');
  }

  return {
    raw: input,
    normalized,
    tokens: tokenize(input),
    tags,
    emotion,
    topicHints
  };
}

function inferQueryEmotion(value) {
  if (value.includes('焦虑') || value.includes('压力') || value.includes('worried') || value.includes('stress')) {
    return 'anxious';
  }

  if (value.includes('拖延') || value.includes('卡住') || value.includes('不想做') || value.includes('stuck')) {
    return 'distracted';
  }

  if (value.includes('想学') || value.includes('学习') || value.includes('ready') || value.includes('start')) {
    return 'motivated';
  }

  return 'neutral';
}

function extractTopicHints(input) {
  const explicitTopics = Array.from(input.matchAll(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g))
    .map((match) => match[0].toLowerCase());
  const cjkPhrases = Array.from(input.matchAll(/[\u4e00-\u9fff]{2,8}/g))
    .map((match) => match[0].toLowerCase())
    .filter((phrase) => !isGenericChinesePhrase(phrase));

  return [...new Set([...explicitTopics, ...cjkPhrases])];
}

function isGenericChinesePhrase(value) {
  const generic = [
    '我想',
    '学习',
    '今天',
    '最近',
    '一直',
    '拖延',
    '焦虑',
    '任务',
    '开始',
    '继续'
  ];

  return generic.includes(value);
}

function scoreTagOverlap(memoryTags, queryTags) {
  let score = 0;

  for (const tag of queryTags) {
    if (memoryTags.has(tag)) {
      score += 1.4;
    }
  }

  return score;
}

function scoreTopicContinuity(memory, queryProfile) {
  if (queryProfile.topicHints.length === 0) {
    return 0;
  }

  const haystack = [
    memory.user_input,
    memory.echo_response,
    memory.memory_note,
    memory.insight_note,
    ...(memory.tags || [])
  ].join(' ').toLowerCase();

  return queryProfile.topicHints.reduce((score, hint) => {
    return haystack.includes(hint) ? score + 1.8 : score;
  }, 0);
}

function collectChannelMatches({
  memory,
  queryProfile,
  textScore,
  tagScore,
  emotionScore,
  topicScore,
  priorityScore,
  recencyScore
}) {
  const channels = [];

  if (textScore > 0 || topicScore > 0) {
    channels.push('direct_match');
  }

  if (emotionScore > 0 || tagScore >= 1.4) {
    channels.push('emotional_resonance');
  }

  if (topicScore > 0 || (queryProfile.tags.has('learning') && memory.tags?.includes('learning'))) {
    channels.push('learning_continuity');
  }

  if (memory.pinned || memory.priority_bucket === 'core' || priorityScore >= 0.92) {
    channels.push('core_anchor');
  }

  if (recencyScore >= 0.35) {
    channels.push('recent_thread');
  }

  return channels;
}

function compareRankedMemories(a, b) {
  const aDirect = a.channel_matches.includes('direct_match') || a.channel_matches.includes('learning_continuity');
  const bDirect = b.channel_matches.includes('direct_match') || b.channel_matches.includes('learning_continuity');

  if (aDirect !== bDirect) {
    return bDirect ? 1 : -1;
  }

  if (b.score !== a.score) {
    return b.score - a.score;
  }

  if (b.channel_matches.length !== a.channel_matches.length) {
    return b.channel_matches.length - a.channel_matches.length;
  }

  return b.effective_priority - a.effective_priority;
}

function pickDiverseMemories(entries, limit) {
  const selected = [];
  const seen = new Set();
  const channels = [
    'direct_match',
    'learning_continuity',
    'emotional_resonance',
    'core_anchor',
    'recent_thread'
  ];

  for (const channel of channels) {
    const match = entries.find((entry) => {
      return entry.channel_matches.includes(channel) && !seen.has(entry.memory.id);
    });

    if (match) {
      selected.push(match.memory);
      seen.add(match.memory.id);
    }

    if (selected.length >= limit) {
      return sortSelectedMemories(selected).slice(0, limit);
    }
  }

  for (const entry of entries) {
    if (seen.has(entry.memory.id)) {
      continue;
    }

    selected.push(entry.memory);
    seen.add(entry.memory.id);

    if (selected.length >= limit) {
      break;
    }
  }

  return sortSelectedMemories(selected);
}

function sortSelectedMemories(memories) {
  return [...memories].sort((a, b) => {
    const scoreDelta = (b.retrieval?.ranking_score || 0) - (a.retrieval?.ranking_score || 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (b.salience || 0) - (a.salience || 0);
  });
}

function computeEffectivePriority(memory) {
  const salience = Number(memory.salience || 0.5);
  const reinforcement = Number(memory.reinforcement_count || 1);
  const decay = getDecayFactor(memory.timestamp, memory.priority_bucket);
  const reinforcementBonus = Math.min(reinforcement * 0.04, 0.4);

  return salience * decay + reinforcementBonus;
}

function getRecencyScore(timestamp) {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = ageMs / 86_400_000;

  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return 0;
  }

  if (ageDays <= 1) return 0.6;
  if (ageDays <= 7) return 0.35;
  if (ageDays <= 30) return 0.15;
  return 0;
}

function getDecayFactor(timestamp, priorityBucket = 'ambient') {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = ageMs / 86_400_000;

  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return 1;
  }

  if (priorityBucket === 'core') {
    return Math.max(0.82, 1 - ageDays * 0.004);
  }

  if (priorityBucket === 'important') {
    return Math.max(0.62, 1 - ageDays * 0.008);
  }

  return Math.max(0.35, 1 - ageDays * 0.016);
}

function getStorePaths() {
  const configuredDbPath = process.env.MARGIN_DB_PATH || process.env.ECHO_DB_PATH;
  const dbPath = configuredDbPath
    ? path.resolve(configuredDbPath)
    : path.join(rootDir, 'data', 'echo.sqlite');
  const dataDir = path.dirname(dbPath);

  return {
    dataDir,
    dbPath,
    legacyMemoryPath: path.join(dataDir, 'memory.json')
  };
}

export function getMemoryStorePaths() {
  return getStorePaths();
}
