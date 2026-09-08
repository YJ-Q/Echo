import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Claude Code's VS Code session manager stores archive truth in the stable Code
// profile, not beside Claude's JSONL files.  Keep this deliberately narrow: the
// reader knows one controller/profile and one globalState key only.
export function resolveClaudeArchiveDbPath({ env = process.env, homedir = os.homedir } = {}) {
  const profile = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
  const appData = env.APPDATA?.trim() || path.join(profile, 'AppData', 'Roaming');
  return path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb');
}

function normalizeIds(value) {
  if (!Array.isArray(value)) throw new Error('hiddenSessionIds must be an array');
  return [...new Set(value.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].sort();
}

function parseGlobalState(value) {
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value)); }
  catch (error) { throw Object.assign(new Error('hiddenSessionIds contains invalid JSON', { cause: error }), { code: 'claude_archive_registry_invalid' }); }
  // VS Code globalState stores the extension's state object under its extension
  // key.  Keep the direct-array form too so fixtures and future storage variants
  // remain narrow and explicit; never scan unrelated globalState keys.
  if (Array.isArray(parsed)) return normalizeIds(parsed);
  if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'hiddenSessionIds')) return null;
  return normalizeIds(parsed.hiddenSessionIds);
}

function readFromSqlite(dbPath) {
  // The project ships sqlite3 for the bundled Node runtime. Use a short-lived
  // read-only helper so this synchronous source-revision boundary does not load
  // a second native SQLite binding compiled for a different Node ABI.
  const script = [
    "import sqlite3 from 'sqlite3';",
    "import { open } from 'sqlite';",
    "const db = await open({ filename: process.env.MARGIN_CLAUDE_ARCHIVE_DB_PATH, driver: sqlite3.Database });",
    "const table = await db.get(\"SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'\");",
    "if (!table) { console.log(JSON.stringify({ kind: 'unavailable', reason: 'archive_registry_missing' })); await db.close(); process.exit(0); }",
    "const row = await db.get('SELECT value FROM ItemTable WHERE key = ?', 'Anthropic.claude-code');",
    "if (!row) { console.log(JSON.stringify({ kind: 'unavailable', reason: 'archive_key_missing' })); await db.close(); process.exit(0); }",
    "console.log(JSON.stringify({ kind: 'ok', value: row.value })); await db.close();",
  ].join('');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, MARGIN_CLAUDE_ARCHIVE_DB_PATH: dbPath },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || '').trim() || 'Claude archive registry sqlite read failed');
  const line = String(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('Claude archive registry sqlite read returned no result');
  const row = JSON.parse(line);
  if (row.kind !== 'ok') return row;
  const archivedIds = parseGlobalState(row.value);
  return archivedIds === null ? { kind: 'unavailable', reason: 'archive_key_missing' } : { kind: 'ok', archivedIds };
}

export function readClaudeArchiveState({ dbPath = resolveClaudeArchiveDbPath(), readState = readFromSqlite } = {}) {
  if (!fs.existsSync(dbPath)) return { ok: true, authoritative: false, status: 'unavailable', archivedIds: [], reason: 'archive_registry_missing' };
  try {
    const result = readState(dbPath);
    if (!result || result.kind === 'unavailable') {
      return { ok: true, authoritative: false, status: 'unavailable', archivedIds: [], reason: result?.reason ?? 'archive_registry_missing' };
    }
    const archivedIds = normalizeIds(result.archivedIds);
    return { ok: true, authoritative: true, status: 'ok', archivedIds };
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.code ??= 'claude_archive_registry_read_failed';
    return { ok: false, authoritative: false, status: 'read-error', archivedIds: [], reason: wrapped.code, error: wrapped };
  }
}

export function archiveStateRevision(state) {
  if (!state?.ok) throw new Error('Claude archive state is not readable');
  const material = state.authoritative ? `ok\n${normalizeIds(state.archivedIds).join('\n')}` : `unavailable\n${state.reason ?? ''}`;
  return createHash('sha256').update(material).digest('hex');
}
