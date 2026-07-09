import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { getMemoryStorePaths, migrateMemoryStoreDatabase } from '../storage/memoryStore.js';

const TABLES = [
  'conversations',
  'user_states',
  'user_profile',
  'learning_sessions',
  'learning_events',
  'actions',
  'operation_proposals',
  'operation_events',
  'summaries'
];

export async function exportEchoDataSnapshot({ outDir } = {}) {
  const storePaths = getMemoryStorePaths();
  const targetDir = outDir
    ? path.resolve(outDir)
    : path.join(path.dirname(storePaths.dbPath), 'exports');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(targetDir, `echo-export-${timestamp}.json`);

  await mkdir(targetDir, { recursive: true });

  const db = await open({
    filename: storePaths.dbPath,
    driver: sqlite3.Database
  });

  try {
    const snapshot = {
      exported_at: new Date().toISOString(),
      source: {
        db_path: storePaths.dbPath
      },
      counts: {},
      data: {}
    };

    for (const table of TABLES) {
      const rows = await db.all(`SELECT * FROM ${table}`);
      snapshot.data[table] = rows;
      snapshot.counts[table] = rows.length;
    }

    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    return {
      format: 'json',
      file_path: filePath,
      counts: snapshot.counts
    };
  } finally {
    await db.close();
  }
}

export async function createSqliteBackup({ outDir } = {}) {
  const storePaths = getMemoryStorePaths();
  const targetDir = outDir
    ? path.resolve(outDir)
    : path.join(path.dirname(storePaths.dbPath), 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(targetDir, `echo-backup-${timestamp}.sqlite`);

  await mkdir(targetDir, { recursive: true });

  const db = await open({
    filename: storePaths.dbPath,
    driver: sqlite3.Database
  });

  try {
    const escapedPath = filePath.replace(/'/g, "''");
    await db.exec(`VACUUM INTO '${escapedPath}'`);
  } finally {
    await db.close();
  }

  const info = await stat(filePath);

  return {
    format: 'sqlite',
    file_path: filePath,
    size_bytes: info.size
  };
}

export async function createBackupBundle({ outDir, includeJson = true, includeSqlite = true } = {}) {
  const results = [];

  if (includeJson) {
    results.push(await exportEchoDataSnapshot({ outDir }));
  }

  if (includeSqlite) {
    results.push(await createSqliteBackup({ outDir }));
  }

  return {
    created_at: new Date().toISOString(),
    files: results
  };
}

export async function importEchoDataSnapshot({
  filePath,
  mode = 'merge',
  dryRun = false,
  targetDbPath
} = {}) {
  if (!filePath) {
    throw new Error('filePath is required for import');
  }

  const snapshot = await readSnapshot(filePath);
  const dbPath = targetDbPath
    ? path.resolve(targetDbPath)
    : getMemoryStorePaths().dbPath;

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  let transactionStarted = false;

  try {
    await migrateMemoryStoreDatabase(db);
    const counts = summarizeSnapshotCounts(snapshot);

    if (dryRun) {
      return {
        mode,
        dry_run: true,
        file_path: path.resolve(filePath),
        target_db_path: dbPath,
        counts
      };
    }

    await db.exec('PRAGMA foreign_keys = OFF;');
    await db.exec('BEGIN TRANSACTION;');
    transactionStarted = true;

    if (mode === 'replace') {
      for (const table of [...TABLES].reverse()) {
        await db.exec(`DELETE FROM ${table};`);
      }
    }

    for (const table of TABLES) {
      const rows = snapshot.data?.[table] || [];

      if (rows.length === 0) {
        continue;
      }

      const columns = await getTableColumns(db, table);

      for (const row of rows) {
        const payload = columns
          .filter((column) => Object.hasOwn(row, column))
          .reduce((result, column) => {
            result[column] = row[column];
            return result;
          }, {});

        if (Object.keys(payload).length === 0) {
          continue;
        }

        const columnList = Object.keys(payload);
        const placeholders = columnList.map(() => '?').join(', ');
        const values = columnList.map((column) => payload[column]);
        await db.run(
          `INSERT OR REPLACE INTO ${table} (${columnList.join(', ')}) VALUES (${placeholders})`,
          ...values
        );
      }
    }

    await db.exec('COMMIT;');
    await db.exec('PRAGMA foreign_keys = ON;');

    return {
      mode,
      dry_run: false,
      file_path: path.resolve(filePath),
      target_db_path: dbPath,
      counts
    };
  } catch (error) {
    if (transactionStarted) {
      await db.exec('ROLLBACK;');
      await db.exec('PRAGMA foreign_keys = ON;');
    }
    throw error;
  } finally {
    await db.close();
  }
}

export async function databaseExists() {
  const storePaths = getMemoryStorePaths();

  try {
    await stat(storePaths.dbPath);
    return true;
  } catch {
    return false;
  }
}

export { TABLES as BACKUP_TABLES };

async function readSnapshot(filePath) {
  const raw = await readFile(path.resolve(filePath), 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('Invalid Echo snapshot: missing data block');
  }

  for (const table of TABLES) {
    if (parsed.data[table] === undefined) {
      parsed.data[table] = [];
    }

    if (!Array.isArray(parsed.data[table])) {
      throw new Error(`Invalid Echo snapshot: ${table} is missing or not an array`);
    }
  }

  return parsed;
}

function summarizeSnapshotCounts(snapshot) {
  return TABLES.reduce((counts, table) => {
    counts[table] = snapshot.data?.[table]?.length || 0;
    return counts;
  }, {});
}

async function getTableColumns(db, table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}
