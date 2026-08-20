import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { randomUUID } from 'node:crypto';
import { MARGIN_CORE_MIGRATIONS } from './migrations/001-margin-core.js';

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
    }
  };

  try {
    await store.migrate();
    return store;
  } catch (error) {
    await db.close();
    throw error;
  }
}
