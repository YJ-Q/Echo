import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { inventoryLegacyData } from '../scripts/inventory-legacy-data.js';

test('legacy inventory reports schema counts and hashes without conversation content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'margin-legacy-inventory-'));
  const dbPath = path.join(directory, 'echo.sqlite');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  try {
    await db.exec('CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_input TEXT, echo_response TEXT); CREATE TABLE profile (id INTEGER PRIMARY KEY, value TEXT);');
    await db.run('INSERT INTO conversations(user_input,echo_response) VALUES (?,?)', 'private-user-text', 'private-assistant-text');
    const result = await inventoryLegacyData({ dbPath });
    assert.equal(result.databaseKind, 'legacy_echo');
    assert.equal(result.tables.find((item) => item.name === 'conversations').rowCount, 1);
    assert.equal(result.tables.find((item) => item.name === 'conversations').disposition, 'archive');
    assert.match(result.schemaHash, /^[a-f0-9]{64}$/);
    assert.match(result.fileHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /private-user-text|private-assistant-text/);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
