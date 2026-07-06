import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

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
      SELECT id, timestamp, user_input, echo_response, emotion, tags
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
      INSERT INTO conversations (timestamp, user_input, echo_response, emotion, tags)
      VALUES (?, ?, ?, ?, ?)
    `,
    memory.timestamp,
    memory.user_input,
    memory.echo_response,
    memory.emotion,
    JSON.stringify(memory.tags || [])
  );

  return memory;
}

export async function getRelevantMemories(input, { limit = 8 } = {}) {
  const memories = await getMemories({ limit: 200 });
  const queryTokens = tokenize(input);

  return memories
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTokens)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.memory);
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

export async function upsertUserProfile(key, value, confidence = 0.5) {
  const db = await getDb();
  const existing = await db.get('SELECT value, confidence FROM user_profile WHERE key = ?', key);
  const nextConfidence = calculateProfileConfidence(existing, value, confidence);

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
    value,
    nextConfidence,
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
        ORDER BY priority ASC, created_at DESC
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
            ELSE 3
          END,
          priority ASC,
          created_at DESC
        LIMIT ?
      `,
      limit
    );

  return rows.map(mapActionRow);
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
  await migrate(db);
  await importLegacyJsonIfNeeded(db);

  return db;
}

async function migrate(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_input TEXT NOT NULL,
      echo_response TEXT NOT NULL,
      emotion TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
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
          INSERT INTO conversations (timestamp, user_input, echo_response, emotion, tags)
          VALUES (?, ?, ?, ?, ?)
        `,
        memory.timestamp,
        memory.user_input,
        memory.echo_response,
        memory.emotion,
        JSON.stringify(memory.tags || [])
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

function calculateProfileConfidence(existing, nextValue, incomingConfidence) {
  if (!existing) {
    return clampConfidence(incomingConfidence);
  }

  if (existing.value === nextValue) {
    return clampConfidence(Math.max(existing.confidence, incomingConfidence) + 0.08);
  }

  return clampConfidence(Math.max(incomingConfidence, existing.confidence * 0.82));
}

function clampConfidence(value) {
  return Math.min(Math.max(value || 0.5, 0.1), 1);
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
    tags: safeJsonArray(row.tags)
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

function scoreMemory(memory, queryTokens) {
  const haystack = [
    memory.user_input,
    memory.echo_response,
    memory.emotion,
    ...(memory.tags || [])
  ].join(' ').toLowerCase();

  const textScore = queryTokens.reduce((score, token) => {
    return haystack.includes(token) ? score + tokenWeight(token, memory) : score;
  }, 0);
  const recencyScore = getRecencyScore(memory.timestamp);

  return textScore > 0 ? textScore + recencyScore : 0;
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
