import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  groupSessionsByWorkspace,
  sortSessionsByUpdatedAt,
  parseSelection,
  formatRelativeTime,
  workspaceRoot,
  renderResumeSummary,
  runMarginCli,
  writeHandoff,
} from '../src/cli/margin/index.js';
import { captureSession, generateHandoff } from '../src/core/handoff/index.js';

function userRecord(text) {
  return JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n';
}

function sink() {
  const parts = [];
  return { write: (s) => parts.push(String(s)), text: () => parts.join('') };
}

// --- Pure selection/ordering ---

test('groupSessionsByWorkspace orders groups and their sessions by newest update, preserving ids', () => {
  const sessions = [
    { id: 'old', workspaceKey: 'git:margin', workspaceName: 'margin', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'new', workspaceKey: 'git:margin', workspaceName: 'margin', updatedAt: '2026-09-05T00:00:00Z' },
    { id: 'other', workspaceKey: 'git:other', workspaceName: 'other', updatedAt: '2026-09-03T00:00:00Z' },
  ];
  const groups = groupSessionsByWorkspace(sessions);
  assert.deepEqual(groups.map(g => [g.workspaceName, g.sessions.map(s => s.id)]), [
    ['margin', ['new', 'old']],
    ['other', ['other']],
  ]);
});

test('sortSessionsByUpdatedAt uses id descending as deterministic tie-breaker', () => {
  const ordered = sortSessionsByUpdatedAt([
    { id: 'a', updatedAt: '2026-09-02T00:00:00Z' },
    { id: 'b', updatedAt: '2026-09-02T00:00:00Z' },
  ]);
  assert.deepEqual(ordered.map(s => s.id), ['b', 'a']);
});

test('parseSelection accepts only valid in-range integers', () => {
  assert.equal(parseSelection('1', 3), 0);
  assert.equal(parseSelection('3', 3), 2);
  assert.equal(parseSelection('0', 3), null);
  assert.equal(parseSelection('4', 3), null);
  assert.equal(parseSelection('', 3), null);
  assert.equal(parseSelection('abc', 3), null);
  assert.equal(parseSelection('1.5', 3), null);
});

test('workspaceRoot recovers git root from identity and falls back to cwd', () => {
  assert.equal(workspaceRoot({ workspaceKey: 'git:d:/repo', cwd: 'd:/repo/subdir' }), 'd:/repo');
  assert.equal(workspaceRoot({ workspaceKey: 'cwd:d:/nonrepo', cwd: 'd:/nonrepo' }), 'd:/nonrepo');
  assert.equal(workspaceRoot({ cwd: 'd:/fallback' }), 'd:/fallback');
});

test('formatRelativeTime maps timestamps to compact wording', () => {
  const now = new Date('2026-09-06T12:00:00Z').getTime();
  assert.equal(formatRelativeTime('2026-09-06T11:54:00Z', now), '6 min ago');
  assert.equal(formatRelativeTime(null, now), null);
});

// --- runMarginCli flow ---

test('no resumable sessions exits non-zero with a clear message', async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await runMarginCli({
    discoverSessions: async () => [],
    prompt: async () => '1',
    stdout,
    stderr,
  });
  assert.equal(code, 1);
  assert.match(stderr.text(), /No resumable Codex sessions/);
});

test('invalid workspace number exits non-zero without prompting for a session', async () => {
  const stdout = sink();
  const stderr = sink();
  let prompts = 0;
  const code = await runMarginCli({
    discoverSessions: async () => [{ id: 's1', workspaceKey: 'cwd:x', workspaceName: 'x', cwd: 'x', updatedAt: '2026-09-05T00:00:00Z' }],
    prompt: async () => { prompts += 1; return '9'; },
    stdout,
    stderr,
  });
  assert.equal(code, 1);
  assert.equal(prompts, 1);
  assert.match(stderr.text(), /Invalid selection/);
});

test('runMarginCli selects the newest session, renders its resume summary, and saves HANDOFF', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-flow-'));
  const sessions = [
    { id: 'old', workspaceKey: `cwd:${repo}`, workspaceName: 'repo', cwd: repo, label: 'Older', branch: 'main', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'chosen', workspaceKey: `cwd:${repo}`, workspaceName: 'repo', cwd: repo, label: 'Chosen', branch: 'main', updatedAt: '2026-09-05T00:00:00Z' },
  ];
  const answers = ['1', '1', ''];
  const prompts = [];
  let capturedSessionId;
  let capturedRepo;
  let savedRepo;
  let savedMarkdown;
  const stdout = sink();
  const stderr = sink();
  const code = await runMarginCli({
    discoverSessions: async () => sessions,
    captureSession: (s) => { capturedSessionId = s.id; return { snapshotPath: 'x', sha256: 'x' }; },
    generateHandoff: (_capture, repoPath) => {
      capturedRepo = repoPath;
      return {
        markdown: '# Real Core Markdown',
        resumeSummary: {
          goal: { text: 'Historical goal' },
          progress: [{ text: 'Some progress' }],
          currentApplicability: { text: 'Check first' },
          currentValidation: { text: 'Not rerun' },
        },
      };
    },
    writeHandoff: ({ repo, markdown }) => { savedRepo = repo; savedMarkdown = markdown; return path.join(repo, '.margin', 'HANDOFF.md'); },
    prompt: async (text) => { prompts.push(text); return answers.shift(); },
    now: () => new Date('2026-09-06T00:00:00Z').getTime(),
    stdout,
    stderr,
  });
  assert.equal(code, 0);
  assert.equal(capturedSessionId, 'chosen');
  assert.equal(capturedRepo, repo);
  assert.equal(savedRepo, repo);
  assert.equal(savedMarkdown, '# Real Core Markdown');
  // resume summary comes from the injected projection (no re-wording)
  assert.ok(stdout.text().includes('Development State'));
  assert.ok(stdout.text().includes('Historical goal'));
  assert.ok(stdout.text().includes('Check first'));
  assert.ok(stdout.text().includes('Not rerun'));
  assert.equal(stderr.text(), '');
});

test('confirming with n exits cleanly without saving', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-abort-'));
  let saved = false;
  const code = await runMarginCli({
    discoverSessions: async () => [{ id: 's1', workspaceKey: `cwd:${repo}`, workspaceName: 'repo', cwd: repo, label: 'X', updatedAt: '2026-09-05T00:00:00Z' }],
    captureSession: () => ({ snapshotPath: 'x', sha256: 'x' }),
    generateHandoff: () => ({ markdown: '# m', resumeSummary: { goal: { text: 'g' }, progress: [], currentApplicability: {}, currentValidation: {} } }),
    writeHandoff: () => { saved = true; return 'x'; },
    prompt: async (text) => (text.includes('Generate handoff') ? 'n' : '1'),
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(code, 0);
  assert.equal(saved, false);
});

// --- Real pipeline + save semantics ---

test('real generateHandoff pipeline writes .margin/HANDOFF.md with the goal', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-real-'));
  const source = path.join(repo, 'session.jsonl');
  fs.writeFileSync(source, userRecord('implement feature X with full detail about validation and layout'));
  const session = { id: 's1', cwd: repo, workspaceKey: `cwd:${repo}`, workspaceName: 'repo', label: 'Implement feature X', updatedAt: new Date().toISOString(), originalPath: source };
  const capture = captureSession(session, path.join(repo, 'snap', 's1.jsonl'), { refreshSnapshot: true });
  const { markdown } = generateHandoff(capture, repo);
  const handoffPath = writeHandoff({ repo, markdown });
  assert.equal(handoffPath, path.join(repo, '.margin', 'HANDOFF.md'));
  const content = fs.readFileSync(handoffPath, 'utf8');
  assert.match(content, /# Margin Smart Handoff/);
  assert.match(content, /implement feature X/);
});

test('writeHandoff overwrites an existing HANDOFF and creates the directory', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-overwrite-'));
  writeHandoff({ repo, markdown: '# First' });
  writeHandoff({ repo, markdown: '# Second' });
  assert.equal(fs.readFileSync(path.join(repo, '.margin', 'HANDOFF.md'), 'utf8'), '# Second');
});

// --- Executable entry ---

test('margin CLI entry executes and reports no sessions against an empty codex home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cli-home-'));
  const bin = path.resolve('bin', 'margin.js');
  const result = spawnSync(process.execPath, [bin], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /No resumable Codex sessions/);
});
