#!/usr/bin/env node
// Usage: node scripts/generate-handoff.js --session <id> --repo <path> [--out <dir>] [--refresh]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSessions, captureSession, generateHandoff } from '../src/core/handoff/index.js';

const args = process.argv.slice(2);
const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const sessionId = get('--session');
const repoPath = get('--repo') ?? process.cwd();
const outDir = get('--out') ?? path.join(process.cwd(), 'handoff-output');
const refresh = args.includes('--refresh');
const listOnly = args.includes('--list');

if (!sessionId && !listOnly) {
  console.error('Usage: node scripts/generate-handoff.js --session <id> [--repo <path>] [--out <dir>] [--refresh]');
  console.error('       node scripts/generate-handoff.js --list');
  process.exit(1);
}

const sessions = await discoverSessions();
if (listOnly) {
  console.log(JSON.stringify(sessions.map(s => ({
    id: s.id, cwd: s.cwd, bytes: s.bytes, updatedAt: s.updatedAt,
    summary: s.summary?.slice(0, 120),
  })), null, 2));
  process.exit(0);
}

const meta = sessions.find(s => s.id === sessionId);
if (!meta) {
  console.error(`Session not found: ${sessionId}`);
  console.error(`Available sessions: ${sessions.map(s => s.id).join(', ') || '(none discovered)'}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const snapshotPath = path.join(outDir, `session-${sessionId}.jsonl`);

console.log(`Capturing session ${sessionId}...`);
const capture = captureSession(meta, snapshotPath, { refreshSnapshot: refresh });
console.log(`Snapshot: ${capture.bytes} bytes, sha256=${capture.sha256.slice(0, 16)}...`);

console.log(`Running pipeline against repo: ${repoPath}`);
const { evidence, truth, state, markdown } = generateHandoff(capture, repoPath);

const handoffPath = path.join(outDir, 'smart-handoff.md');
fs.writeFileSync(handoffPath, markdown);
console.log(`\nSmart Handoff written to: ${handoffPath}`);
console.log(`Evidence: ${evidence.nodes.length} nodes, ${evidence.operations.length} operations`);
console.log(`Coverage: ${evidence.coverage.toolCalls} tool calls, ${evidence.coverage.matchedCalls} matched`);
console.log(`Repo Truth: ${truth.files.length} files observed, git=${truth.git.status}`);
console.log(`State: goal=${state.goal.length > 0 ? 'present' : 'missing'}, completed=${state.completed.length}, openIssues=${state.openIssues.length}`);
console.log('\n--- Smart Handoff Preview (first 40 lines) ---');
console.log(markdown.split('\n').slice(0, 40).join('\n'));
