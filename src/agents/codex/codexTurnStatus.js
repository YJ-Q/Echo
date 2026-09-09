import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// This reader deliberately knows only Codex's native terminal projection.  In
// particular, it never inspects rollout/tool output and never writes to Codex.
export function codexHistoryPath(codexHome) {
  return path.join(codexHome, 'thread_history_1.sqlite');
}

function structuredError(value) {
  if (value === null || value === undefined || value === '') return false;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

function terminalStatus(row) {
  if (!row) return { executionStatus: 'unknown', terminal: null };
  const failure = row.status === 'failed' && structuredError(row.error_json);
  return {
    executionStatus: failure ? 'error' : 'idle',
    terminal: {
      threadId: row.thread_id,
      turnId: row.turn_id,
      rolloutOrdinal: row.rollout_ordinal,
      status: row.status,
      hasStructuredError: structuredError(row.error_json),
      // Native epoch seconds are the stable comparison watermark across the
      // SQLite projection and JSONL lifecycle records.
      at: row.completed_at ?? row.started_at ?? null,
    },
  };
}

export async function readLatestCodexTurnStatus(codexHome, nativeSessionId, { dbPath = codexHistoryPath(codexHome), openDb = open, fsImpl = fs } = {}) {
  if (!nativeSessionId) return { ok: true, available: true, executionStatus: 'unknown', terminal: null };
  if (!fsImpl.existsSync(dbPath)) return { ok: true, available: false, reason: 'unavailable', executionStatus: 'unknown', terminal: null };
  let db;
  try {
    db = await openDb({ filename: dbPath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    const row = await db.get(`
      SELECT thread_id, turn_id, rollout_ordinal, status, error_json, started_at, completed_at
      FROM thread_turns
      WHERE thread_id = ? AND status IN ('completed', 'failed', 'interrupted')
      ORDER BY rollout_ordinal DESC, COALESCE(completed_at, started_at) DESC
      LIMIT 1`, nativeSessionId);
    return { ok: true, available: true, ...terminalStatus(row) };
  } catch (error) {
    return { ok: false, available: true, reason: 'read_failed', error: { code: 'codex_terminal_read_failed', message: error?.message ?? 'Codex terminal status read failed' }, executionStatus: 'unknown', terminal: null };
  } finally {
    try { await db?.close(); } catch { /* read failure is already represented above */ }
  }
}

export const hasStructuredCodexError = structuredError;
