import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createApp } from '../src/app.js';
import {
  closeMemoryStore,
  createLearningSession,
  ensureMemoryStore,
  getMemoryStorePaths
} from '../src/storage/memoryStore.js';
import { buildAchievementViewModel } from '../src/services/achievementViewModel.js';
import { BACKUP_TABLES, exportEchoDataSnapshot, importEchoDataSnapshot } from '../src/services/backupService.js';

test('achievement unlocks persist once and survive source churn', async () => {
  await withAchievementDatabase(async ({ dbPath }) => {
    await createLearningSession({
      topic: 'Node.js',
      steps: [{ title: 'Draft the path', status: 'pending' }]
    });

    const firstView = await buildAchievementViewModel();
    const firstAchievement = firstView.achievements.find((achievement) => achievement.key === 'learning:new_path');

    assert.ok(firstAchievement);
    assert.equal(firstAchievement.unlocked, true);
    assert.equal(firstAchievement.is_new, true);
    assert.equal(await countRows(dbPath, 'achievement_unlocks'), 1);
    assert.equal(firstView.recent_unlocks.filter((unlock) => unlock.key === 'learning:new_path').length, 1);

    const secondView = await buildAchievementViewModel();
    assert.equal(await countRows(dbPath, 'achievement_unlocks'), 1);
    assert.equal(secondView.recent_unlocks.filter((unlock) => unlock.key === 'learning:new_path').length, 1);

    await execSql(dbPath, 'DELETE FROM learning_sessions');
    await closeMemoryStore();
    await ensureMemoryStore();

    const afterDeleteView = await buildAchievementViewModel();
    const afterDeleteAchievement = afterDeleteView.achievements.find((achievement) => achievement.key === 'learning:new_path');

    assert.ok(afterDeleteAchievement);
    assert.equal(afterDeleteAchievement.unlocked, true);
    assert.equal(afterDeleteView.recent_unlocks[0].key, 'learning:new_path');
    assert.equal(afterDeleteView.recent_unlocks[0].is_new, true);
  });
});

test('POST /achievements/:key/acknowledge marks unlocks as seen and stays idempotent', async () => {
  await withAchievementDatabase(async ({ dbPath }) => {
    await createLearningSession({
      topic: 'TypeScript',
      steps: [{ title: 'First checkpoint', status: 'pending' }]
    });

    await buildAchievementViewModel();

    const { baseUrl, server, cleanup } = await startAchievementServer();

    try {
      const ackResponse = await fetch(`${baseUrl}/achievements/learning:new_path/acknowledge`, {
        method: 'POST'
      });
      const ackBody = await ackResponse.json();

      assert.equal(ackResponse.status, 200);
      assert.equal(ackBody.ok, true);
      assert.equal(ackBody.data.achievement.key, 'learning:new_path');
      assert.equal(ackBody.data.achievement.is_new, false);

      const acknowledgedUnlock = await getAchievementUnlock(dbPath, 'learning:new_path');
      assert.ok(acknowledgedUnlock.acknowledged_at);

      const repeatResponse = await fetch(`${baseUrl}/achievements/learning:new_path/acknowledge`, {
        method: 'POST'
      });
      const repeatBody = await repeatResponse.json();

      assert.equal(repeatResponse.status, 200);
      assert.equal(repeatBody.data.achievement.key, 'learning:new_path');
      assert.equal(repeatBody.data.achievement.acknowledged_at, acknowledgedUnlock.acknowledged_at);

      const missingResponse = await fetch(`${baseUrl}/achievements/not-a-real-key/acknowledge`, {
        method: 'POST'
      });
      const missingBody = await missingResponse.json();

      assert.equal(missingResponse.status, 404);
      assert.equal(missingBody.ok, false);
      assert.equal(missingBody.error.code, 'achievement_not_found');
    } finally {
    await cleanup(server);
    }
  });
});

test('backup snapshots include achievement tables in export and import', async () => {
  await withAchievementDatabase(async ({ tempDir, dbPath }) => {
    await createLearningSession({
      topic: 'Backup flow',
      steps: [{ title: 'Seed unlock', status: 'pending' }]
    });
    await buildAchievementViewModel();

    const exportDir = path.join(tempDir, 'exports');
    const snapshot = await exportEchoDataSnapshot({ outDir: exportDir });
    const parsed = JSON.parse(await readFile(snapshot.file_path, 'utf8'));

    assert.equal(snapshot.format, 'json');
    assert.ok(BACKUP_TABLES.includes('achievement_definitions'));
    assert.ok(BACKUP_TABLES.includes('achievement_unlocks'));
    assert.ok(Array.isArray(parsed.data.achievement_definitions));
    assert.ok(Array.isArray(parsed.data.achievement_unlocks));
    assert.equal(snapshot.counts.achievement_definitions, parsed.data.achievement_definitions.length);
    assert.equal(snapshot.counts.achievement_unlocks, parsed.data.achievement_unlocks.length);

    const importDir = await mkdtemp(path.join(os.tmpdir(), 'echo-achievement-import-'));
    const targetDbPath = path.join(importDir, 'echo.sqlite');

    try {
      const imported = await importEchoDataSnapshot({
        filePath: snapshot.file_path,
        mode: 'replace',
        targetDbPath
      });

      assert.equal(imported.mode, 'replace');

      const importedDb = await open({
        filename: targetDbPath,
        driver: sqlite3.Database
      });

      try {
        const importedDefinitionCount = await importedDb.get('SELECT COUNT(*) AS count FROM achievement_definitions');
        const importedUnlockCount = await importedDb.get('SELECT COUNT(*) AS count FROM achievement_unlocks');

        assert.equal(importedDefinitionCount.count, snapshot.counts.achievement_definitions);
        assert.equal(importedUnlockCount.count, snapshot.counts.achievement_unlocks);
      } finally {
        await importedDb.close();
      }
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }

    const storePaths = getMemoryStorePaths();
    assert.equal(storePaths.dbPath, dbPath);
  });
});

async function withAchievementDatabase(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'echo-achievement-'));
  const dbPath = path.join(tempDir, 'echo.sqlite');
  const previousEchoDbPath = process.env.ECHO_DB_PATH;
  const previousMarginDbPath = process.env.MARGIN_DB_PATH;

  process.env.ECHO_DB_PATH = dbPath;
  delete process.env.MARGIN_DB_PATH;

  await closeMemoryStore();

  try {
    await ensureMemoryStore();
    await run({ tempDir, dbPath });
  } finally {
    await closeMemoryStore();

    if (previousEchoDbPath === undefined) {
      delete process.env.ECHO_DB_PATH;
    } else {
      process.env.ECHO_DB_PATH = previousEchoDbPath;
    }

    if (previousMarginDbPath === undefined) {
      delete process.env.MARGIN_DB_PATH;
    } else {
      process.env.MARGIN_DB_PATH = previousMarginDbPath;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
}

async function startAchievementServer() {
  const app = await createApp();

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    cleanup: async (activeServer) => {
      await new Promise((resolve, reject) => {
        activeServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  };
}

async function countRows(dbPath, table) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    const row = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
    return row.count;
  } finally {
    await db.close();
  }
}

async function getAchievementUnlock(dbPath, key) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    return await db.get(
      `
        SELECT key, source_type, source_id, unlocked_at, acknowledged_at, created_at, updated_at
        FROM achievement_unlocks
        WHERE key = ?
      `,
      key
    );
  } finally {
    await db.close();
  }
}

async function execSql(dbPath, sql) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec(sql);
  } finally {
    await db.close();
  }
}
