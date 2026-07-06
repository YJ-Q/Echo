import dotenv from 'dotenv';
import { createBackupBundle, databaseExists } from '../src/services/backupService.js';

dotenv.config();

const options = parseArgs(process.argv.slice(2));
const exists = await databaseExists();

if (!exists) {
  console.error('Echo database not found. Start the app once or set ECHO_DB_PATH to an existing database.');
  process.exit(1);
}

const result = await createBackupBundle({
  outDir: options.outDir,
  includeJson: options.format === 'json' || options.format === 'both',
  includeSqlite: options.format === 'sqlite' || options.format === 'both'
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(args) {
  const options = {
    format: 'both',
    outDir: ''
  };

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }

    if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
    }
  }

  if (!['json', 'sqlite', 'both'].includes(options.format)) {
    console.error('Invalid --format. Use json, sqlite, or both.');
    process.exit(1);
  }

  return options;
}
