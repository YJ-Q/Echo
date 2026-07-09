#!/usr/bin/env node
import { buildManagementOverview, normalizeManagementScope } from '../src/services/managementOverviewEngine.js';
import { closeMemoryStore, ensureMemoryStore } from '../src/storage/memoryStore.js';

const args = parseArgs(process.argv.slice(2));
const scope = normalizeManagementScope(args.scope || 'all');

try {
  await ensureMemoryStore();
  const overview = await buildManagementOverview({ scope });

  if (args.json) {
    console.log(JSON.stringify(overview, null, 2));
  } else {
    printOverview(overview);
  }
} finally {
  await closeMemoryStore();
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--scope') {
      result.scope = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--scope=')) {
      result.scope = arg.slice('--scope='.length);
    }
  }

  return result;
}

function printOverview(overview) {
  if (overview.scope === 'all') {
    console.log(`Scope: all`);
    console.log(overview.summary);
    console.log('');
    for (const item of overview.scopes) {
      printScopedOverview(item);
      console.log('');
    }
    return;
  }

  printScopedOverview(overview);
}

function printScopedOverview(overview) {
  console.log(`Scope: ${overview.scope}`);
  console.log(`Summary: ${overview.summary}`);
  console.log(`Risk: ${overview.risk_level}`);
  console.log(`Candidates: ${overview.candidates.length}`);

  for (const candidate of overview.candidates.slice(0, 8)) {
    console.log(`- [${candidate.suggested_operation}] ${candidate.title}`);
    console.log(`  ${candidate.reason}`);
  }
}

