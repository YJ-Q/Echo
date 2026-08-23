import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function exportLegacyData({ dbPath, outputPath, approved = false, clock = () => new Date().toISOString() }) {
  if (!approved) throw new Error('explicit_legacy_export_approval_required');
  if (!dbPath || !outputPath) throw new TypeError('legacy_export_paths_required');
  const db = await open({ filename: dbPath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    const names = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const tables = {};
    for (const { name } of names) tables[name] = await db.all(`SELECT * FROM ${JSON.stringify(name)}`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify({ format: 'margin-legacy-export-v1', exportedAt: clock(), source: path.resolve(dbPath), tables }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return { outputPath: path.resolve(outputPath), tableCount: names.length };
  } finally { await db.close(); }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const dbPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.resolve('data', 'echo.sqlite');
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const result = await exportLegacyData({ dbPath, outputPath, approved: args.has('--approve') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
