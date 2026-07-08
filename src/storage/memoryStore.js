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

async function getLearningSessionById(id) {
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
  const dbPath = process.env.ECHO_DB_PATH
    ? path.resolve(process.env.ECHO_DB_PATH)
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
