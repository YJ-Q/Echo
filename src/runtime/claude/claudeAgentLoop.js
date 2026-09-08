import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_ITERATIONS = 20;
// Keep last N messages to avoid token overflow; preserve system context
const MAX_HISTORY_MESSAGES = 40;

function buildToolDefinitions(v1Tools, extraTools = []) {
  const defs = [];

  const coreToolSchemas = {
    memory_search: {
      description: 'Search confirmed Margin memories for a project.',
      input_schema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' }, projectId: { type: 'string' },
          query: { type: 'string' }, topK: { type: 'integer', minimum: 1, maximum: 10 },
          asOf: { type: 'string' }, taskId: { type: 'string' },
          memoryTypes: { type: 'array', items: { type: 'string' } }
        },
        required: ['requestId', 'projectId', 'query', 'asOf']
      }
    },
    memory_propose: {
      description: 'Propose a durable Margin memory for review.',
      input_schema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' }, projectId: { type: 'string' }, content: { type: 'string' },
          memoryType: { type: 'string', enum: ['fact', 'preference', 'constraint', 'context', 'sensitive'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 }, validFrom: { type: 'string' },
          durableIntent: { type: 'boolean' }, taskId: { type: 'string' }, expiresAt: { type: 'string' }
        },
        required: ['requestId', 'projectId', 'content', 'memoryType', 'confidence', 'validFrom', 'durableIntent']
      }
    },
    state_update: {
      description: 'Apply a governed state update to project or task.',
      input_schema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' }, projectId: { type: 'string' },
          operation: { type: 'string', enum: ['update_project', 'create_task', 'update_task', 'record_blocker', 'complete_task', 'replace_decision', 'revoke_decision'] },
          taskId: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 },
          changes: { type: 'object' }, task: { type: 'object' },
          decisionKey: { type: 'string' }, content: { type: 'string' },
          effectiveAt: { type: 'string' }, expiresAt: { type: 'string' }
        },
        required: ['requestId', 'projectId', 'operation']
      }
    },
    action_update: {
      description: 'Create or transition a governed Margin action.',
      input_schema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' }, projectId: { type: 'string' },
          operation: { type: 'string', enum: ['create', 'activate', 'complete', 'cancel'] },
          actionId: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 },
          taskId: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' },
          riskLevel: { type: 'string', enum: ['read_only', 'internal_write', 'external_write', 'high_risk'] },
          dueAt: { type: 'string' }
        },
        required: ['requestId', 'projectId', 'operation']
      }
    }
  };

  for (const [name, schema] of Object.entries(coreToolSchemas)) {
    if (v1Tools?.[name]) defs.push({ name, ...schema });
  }

  for (const tool of extraTools) {
    defs.push({
      name: tool.name,
      description: tool.description ?? tool.label ?? tool.name,
      input_schema: tool.parameters ?? { type: 'object', properties: {}, required: [] }
    });
  }

  return defs;
}

async function executeTool(name, input, v1Tools, extraTools, invocationContext) {
  if (v1Tools?.[name]) {
    try {
      const context = { actorType: 'agent', permissions: {}, confirmations: [], ...invocationContext };
      const result = await v1Tools[name](input, context);
      return JSON.stringify(result?.ok
        ? { ok: true, data: result.data, auditId: result.auditId }
        : { ok: false, error: result.error, auditId: result.auditId }
      );
    } catch (err) {
      return JSON.stringify({ ok: false, error: { code: 'tool_execution_failed', message: err.message } });
    }
  }

  const extra = extraTools?.find(t => t.name === name);
  if (extra?.handler) {
    try {
      const result = await extra.handler(input, invocationContext ?? {});
      return JSON.stringify(result?.ok !== undefined ? result : { ok: true, data: result });
    } catch (err) {
      return JSON.stringify({ ok: false, error: { code: 'tool_execution_failed', message: err.message } });
    }
  }

  return JSON.stringify({ ok: false, error: { code: 'unknown_tool', name } });
}

// ── Persistent history store ─────────────────────────────────────────────────

async function openHistoryStore(dbPath) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  `);
  return {
    load: (sessionId) => {
      const rows = db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id').all(sessionId);
      return rows.map(r => ({ role: r.role, content: JSON.parse(r.content) }));
    },
    append: (sessionId, role, content) => {
      db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, role, JSON.stringify(content));
    },
    clear: (sessionId) => {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    },
    close: () => db.close()
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createClaudeAgentLoop({ apiKey, model, systemPrompt, v1Tools, extraTools = [], invocationContext, dbPath, sessionId = 'default' } = {}) {
  const resolvedApiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.YAPI_API_KEY;
  const resolvedBaseUrl = process.env.ANTHROPIC_BASE_URL ?? (process.env.YAPI_API_KEY && !process.env.ANTHROPIC_API_KEY ? 'https://yapi.click' : undefined);
  const client = new Anthropic({
    apiKey: resolvedApiKey,
    ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {})
  });
  const resolvedModel = model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const toolDefs = buildToolDefinitions(v1Tools, extraTools);
  const hasTools = toolDefs.length > 0;

  const resolvedDbPath = dbPath ?? path.join('data', 'claude-agent', 'history.sqlite');
  const store = await openHistoryStore(resolvedDbPath);

  // Load persisted history on startup
  const history = store.load(sessionId);

  function trimHistory() {
    while (history.length > MAX_HISTORY_MESSAGES) history.splice(0, 2);
  }

  async function handle(userText) {
    if (!userText?.trim()) return { text: '' };

    history.push({ role: 'user', content: userText });
    store.append(sessionId, 'user', userText);
    trimHistory();

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: resolvedModel,
        max_tokens: 4096,
        messages: history,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(hasTools ? { tools: toolDefs } : {})
      });

      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      history.push({ role: 'assistant', content: response.content });
      store.append(sessionId, 'assistant', response.content);

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        return { text: textBlocks.map(b => b.text).join('\n').trim(), kind: 'message' };
      }

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => ({
          type: 'tool_result',
          tool_use_id: block.id,
          content: await executeTool(block.name, block.input, v1Tools, extraTools, invocationContext)
        }))
      );

      history.push({ role: 'user', content: toolResults });
      store.append(sessionId, 'user', toolResults);
    }

    return { text: '[agent loop: max iterations reached]', kind: 'error' };
  }

  function reset() {
    history.length = 0;
    store.clear(sessionId);
  }

  function getHistoryLength() { return history.length; }
  function close() { store.close(); }

  return { handle, reset, getHistoryLength, close };
}
