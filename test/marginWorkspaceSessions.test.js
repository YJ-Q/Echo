import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalizeWorkspacePath, resolveWorkspaceIdentity, resumableSessions, sessionLabel } from '../src/core/handoff/session-source.js';

function userRecord(text) {
  return JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
}

test('workspace identity groups repo root and child cwd under one Git key', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-workspace-'));
  try {
    spawnSync('git', ['init', '-q', repo]);
    fs.mkdirSync(path.join(repo, 'web')); fs.mkdirSync(path.join(repo, 'src'));
    const identities = [repo, path.join(repo, 'web'), path.join(repo, 'src')].map(cwd => resolveWorkspaceIdentity({ cwd }));
    assert.equal(new Set(identities.map(identity => identity.workspaceKey)).size, 1);
    assert.ok(identities[0].workspaceKey.startsWith('git:'));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('canonical workspace paths normalize Windows spelling variants and non-Git falls back to cwd', () => {
  const cwd = process.cwd();
  const variants = [cwd, cwd.replace(/\\/g, '/').toLowerCase(), `${cwd}\\`];
  assert.equal(new Set(variants.map(canonicalizeWorkspacePath)).size, 1);
  const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-nongit-'));
  try { assert.ok(resolveWorkspaceIdentity({ cwd: nonGit }).workspaceKey.startsWith('cwd:')); }
  finally { fs.rmSync(nonGit, { recursive: true, force: true }); }
});

test('session labels use summary, skip pasted wrappers, and deterministically truncate or fall back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-label-'));
  try {
    const source = path.join(dir, 'source.jsonl');
    fs.writeFileSync(source, `${userRecord('Files pasted by the user...')}\n${userRecord('Implement Workspace-aware Recent Sessions for Margin with deterministic labels.')}\n`);
    assert.equal(sessionLabel({ id: '123456789', summary: 'Fix Smart Handoff progress state', originalPath: source }), 'Fix Smart Handoff progress state');
    assert.equal(sessionLabel({ id: '123456789', summary: null, originalPath: source }), 'Implement Workspace-aware Recent Sessions for Margin with deterministic labels.');
    assert.equal(sessionLabel({ id: '123456789', summary: null, originalPath: path.join(dir, 'missing.jsonl') }), 'Untitled session · 12345678');
    assert.match(sessionLabel({ id: 'x', summary: `Implement ${'a'.repeat(100)}`, originalPath: source }), /…$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session label reads the explicitly referenced pasted-text attachment after its wrapper', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pasted-label-'));
  try {
    const attachment = path.join(dir, 'pasted-text.txt');
    const source = path.join(dir, 'source.jsonl');
    fs.writeFileSync(attachment, 'Implement Workspace-aware Recent Sessions');
    fs.writeFileSync(source, `${userRecord(`Files pasted by the user:\n## "request": ${attachment}\nPasted text contains the user's request.`)}\n`);
    assert.equal(sessionLabel({ id: 'pasted', summary: null, originalPath: source }), 'Implement Workspace-aware Recent Sessions');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resumable sessions include derived workspace and label fields after internal filtering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-derived-'));
  try {
    const source = path.join(dir, 'source.jsonl');
    fs.writeFileSync(source, `${JSON.stringify({ type: 'session_meta', payload: { thread_source: 'user' } })}\n${userRecord('Implement grouped sessions')}\n`);
    const [session] = resumableSessions([{ id: 'session123', cwd: dir, summary: null, updatedAt: new Date(), originalPath: source, threadSource: 'user' }]);
    assert.equal(session.label, 'Implement grouped sessions');
    assert.ok(session.workspaceKey.startsWith('cwd:'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
