import dotenv from 'dotenv';
import { importEchoDataSnapshot } from '../src/services/backupService.js';

dotenv.config();

const options = parseArgs(process.argv.slice(2));

if (!options.file) {
  console.error('Missing --file=... for Echo import.');
  process.exit(1);
}

const result = await importEchoDataSnapshot({
  filePath: options.file,
  mode: options.mode,
  dryRun: options.dryRun,
  targetDbPath: options.dbPath
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(args) {
  const options = {
    file: '',
    mode: 'merge',
    dryRun: false,
    dbPath: ''
  };

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length);
      continue;
    }

    if (arg.startsWith('--mode=')) {
      options.mode = arg.slice('--mode='.length);
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--db-path=')) {
      options.dbPath = arg.slice('--db-path='.length);
    }
  }

  if (!['merge', 'replace'].includes(options.mode)) {
    console.error('Invalid --mode. Use merge or replace.');
    process.exit(1);
  }

  return options;
}
