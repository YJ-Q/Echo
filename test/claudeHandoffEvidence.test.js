import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readClaudeSessionSource } from '../src/agents/claude/claudeSessionSource.js';
import { buildClaudeEvidence } from '../src/agents/claude/claudeEvidence.js';
import { generateClaudeHandoff } from '../src/agents/claude/claudeHandoff.js';
import { distill } from '../src/core/handoff/distiller.js';
import { captureSession } from '../src/core/handoff/session-source.js';
import { createHandoffArtifact, snapshotPathForCanonicalSession } from '../src/core/handoff/handoffArtifact.js';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';
import { adapterFor } from '../src/agents/adapters.js';

//
// Fixture helpers — build a real Claude JSONL snapshot + hash-verified capture using the
// verified Claude Code 2.1.258 schema (top-level `type`; assistant tool_use / user tool_result).
//
const SESSION_TS = '2026-01-01T00:00:00.000Z';
const ctx = (cwd = 'D:\\fixture') => ({ cwd, sessionId: 'S', version: '2.1.258', gitBranch: 'main',
  userType: 'external', entrypoint: 'claude-vscode', permissionMode: 'auto', timestamp: SESSION_TS, isSidechain: false });
const userText = (parent, text) => ({ parentUuid: parent ?? null, type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] }, uuid: `u-${Math.random()}`, ...ctx() });
const assistantText = (parent, text) => ({ parentUuid: parent ?? null, type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] }, uuid: `a-${Math.random()}`, ...ctx() });
const toolCall = (parent, callId, name, input) => ({ parentUuid: parent ?? null, type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: callId, name, input }] }, uuid: `ac-${callId}`, ...ctx() });
const toolResult = (parent, callId, { is_error, content = 'ok', sidechain = false }) => ({ parentUuid: parent ?? null, type: 'user', isSidechain: sidechain,
  message: { role: 'user', content: [{ tool_use_id: callId, type: 'tool_result', content, ...(is_error !== undefined ? { is_error } : {}) }] }, uuid: `ur-${callId}`, ...ctx() });
const compactBoundary = (parent) => ({ parentUuid: parent ?? null, logicalParentUuid: parent ?? null, type: 'system',
  subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info', uuid: `cb-${Math.random()}`,
  compactMetadata: { trigger: 'auto', preTokens: 100, postTokens: 10, cumulativeDroppedTokens: 90 }, ...ctx() });
const compactSummary = (parent) => userText(parent, 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent: Build the widget.');

function writeSnapshot(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-evidence-'));
  const snapshotPath = path.join(dir, 'session.jsonl');
  const raw = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(snapshotPath, raw);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const capture = { snapshotPath, sha256, capturedAt: new Date().toISOString(), originalPath: snapshotPath,
    sessionId: 'S', canonicalId: 'claude:src:S', sourceId: 'src', agentType: 'claude', nativeSessionId: 'S', cwd: 'D:\\fixture' };
  return buildClaudeEvidence(readClaudeSessionSource(capture));
}

test('Claude evidence: plain foreground requirement and assistant claim recovered; bookkeeping excluded; no forged tool evidence', () => {
  const e = writeSnapshot([
    { type: 'queue-operation', operation: 'enqueue', timestamp: SESSION_TS, sessionId: 'S' },
    { type: 'ai-title', aiTitle: 'T', timestamp: SESSION_TS, sessionId: 'S' },
    userText(null, 'Implement feature X with focused tests'),
    assistantText('u0', 'Let me check the approach.'),
    { type: 'atis-latch', timestamp: SESSION_TS, sessionId: 'S' },
    assistantText('a1', 'Done implementing X with its checks.'),
  ]);
  const reqs = e.nodes.filter(n => n.kind === 'User requirement').map(n => n.text);
  const claims = e.nodes.filter(n => n.kind === 'Assistant claim').map(n => n.text);
  assert.ok(reqs.some(t => /feature X/.test(t)));
  assert.ok(claims.some(t => /Done implementing X/.test(t)));
  assert.equal(e.nodes.filter(n => n.kind === 'Tool call').length, 0, 'no tool call is fabricated');
  assert.equal(e.operations.length, 0, 'no operation is fabricated');
  assert.ok(e.coverage.rawRecords >= 6);
});

test('Claude evidence: tool pairings — success, isError, unmatched; Bash->shell/test ops; Edit/Write->edit ops; read->no op', () => {
  const e = writeSnapshot([
    toolCall(null, 'c1', 'Bash', { command: 'node --test test/x.test.js', description: 'run tests' }),
    toolResult('ac-c1', 'c1', { is_error: false, content: '# pass 12\n' }),
    toolCall('ur-c1', 'c2', 'Edit', { file_path: 'D:\\fixture\\a.js', old_string: 'x', new_string: 'y', replace_all: false }),
    toolResult('ac-c2', 'c2', { is_error: true, content: 'Edit failed' }),
    toolCall('ur-c2', 'c3', 'Read', { file_path: 'D:\\fixture\\big.txt', limit: 60 }),
    toolResult('ac-c3', 'c3', { is_error: false, content: 'some file content' }),
    toolCall('ur-c3', 'c4', 'Bash', { command: 'npm install', description: 'dep' }),
  ]);
  // Bash success -> shell operation + test execution (node --test)
  const b1 = e.operations.find(o => o.id === 'Bash:c1');
  assert.equal(b1.status, 'succeeded');
  assert.equal(b1.command, 'node --test test/x.test.js');
  assert.equal(b1.kinds.test, true, 'node --test recognized as test kind');
  assert.ok(e.nodes.some(n => n.kind === 'Test execution' && n.operationId === b1.id));
  // Edit is_error -> failed
  const e2 = e.operations.find(o => o.id === 'Edit:c2');
  assert.equal(e2.status, 'failed');
  assert.equal(e2.reason, 'Explicit is_error in tool_result');
  assert.equal(e2.edits[0].path, path.join('D:\\fixture\\a.js'));
  assert.ok(e.nodes.some(n => n.kind === 'File edit/write' && n.path === path.join('D:\\fixture\\a.js')));
  // Read -> Tool nodes only, no shell/edit operation
  assert.equal(e.operations.some(o => o.id === 'Read:c3'), false);
  assert.ok(e.nodes.some(n => n.kind === 'Tool call' && n.callId === 'c3'));
  assert.ok(e.nodes.some(n => n.kind === 'Tool result' && n.callId === 'c3'));
  // Unmatched/in-flight -> unknown, never success
  const b4 = e.operations.find(o => o.id === 'Bash:c4');
  assert.equal(b4.status, 'unknown');
  assert.equal(b4.confidence, 'Uncertain');
  assert.match(b4.reason, /incomplete\/unmatched/);
  assert.equal(e.nodes.find(n => n.id === 'call:c4').resultIds.length, 0);
  assert.ok(e.warnings.some(w => /incomplete/.test(w.message)));
  assert.equal(e.coverage.matchedCalls, 3);
});

test('Claude evidence: compaction — summary appears once, not a new Goal, folded history not re-enumerated', () => {
  const e = writeSnapshot([
    userText(null, 'Early context that gets compacted away'),
    assistantText('u0', 'early work 1'),
    compactBoundary('a1'),
    compactSummary('cb-1'),
    userText('us-1', 'later real task'),
    assistantText('us-1', 'did the real task with tests'),
  ]);
  const reqs = e.nodes.filter(n => n.kind === 'User requirement').map(n => n.text);
  const claims = e.nodes.filter(n => n.kind === 'Assistant claim').map(n => n.text);
  const ctxs = e.nodes.filter(n => n.kind === 'Internal context/control').map(n => n.scope);
  assert.ok(claims.some(t => /did the real task/.test(t)), 'post-compaction claim present');
  assert.ok(!reqs.some(t => /Early context/.test(t)), 'folded pre-compaction requirement not enumerated');
  assert.ok(!reqs.some(t => /Primary Request and Intent/.test(t)), 'compaction summary must not become a Goal');
  assert.equal(ctxs.filter(s => /compaction/i.test(s)).length, 1, 'compaction summary appears exactly once');
});

test('Claude evidence: sidechain/subagent records excluded from foreground; Agent tool call retained as tool evidence', () => {
  const sidechainUser = (parent, text) => ({ ...ctx(), parentUuid: parent ?? null, type: 'user', isSidechain: true,
    message: { role: 'user', content: [{ type: 'text', text }] }, uuid: `sc-${Math.random()}` });
  const e = writeSnapshot([
    userText(null, 'Main task'),
    assistantText('u0', 'spawning a subagent'),
    // Agent subagent spawn is an assistant tool_use (foreground tool evidence).
    toolCall('a1', 't1', 'Agent', { description: 'research', subagent_type: 'Explore', prompt: 'research X' }),
    toolResult('ac-t1', 't1', { is_error: false, content: 'Agent finished' }),
    // Subagent transcript injected as task-notification user content (not foreground).
    { parentUuid: 'ur-t1', isSidechain: false, type: 'user',
      message: { role: 'user', content: '<task-notification>\n<task-id>x</task-id>\n<summary>Agent finished</summary></task-notification>' },
      uuid: `n-${Math.random()}`, ...ctx() },
    // A true sidechain message (as in subagents/*.jsonl) must not become foreground.
    sidechainUser('n1', 'sidechain-only content that must not pollute'),
  ]);
  const reqs = e.nodes.filter(n => n.kind === 'User requirement').map(n => n.text);
  assert.ok(reqs.some(t => /Main task/.test(t)));
  assert.ok(!reqs.some(t => /sidechain-only content/.test(t)), 'sidechain requirement must not enter foreground');
  assert.ok(!reqs.some(t => /task-notification/i.test(t)), 'subagent transcript must not be a Goal');
  // Agent tool call is retained as tool evidence but produces no shell/edit operation.
  assert.ok(e.nodes.some(n => n.kind === 'Tool call' && n.name === 'Agent'));
  assert.equal(e.operations.length, 0, 'Agent tool call produces no structured operation');
});

test('Claude evidence + Shared Core safety: assistant "tests pass" claim is not promoted to current validation', () => {
  const e = writeSnapshot([
    userText(null, 'Implement a feature and make tests pass'),
    assistantText('u0', 'I ran the suite and all tests passed.'),
  ]);
  const truth = { capturedAt: 'now', workspace: 'D:\\fixture', stableDuringObservation: true,
    git: { status: 'available', branch: 'main', head: 'abc', changes: [] }, files: [], patchChecks: [], artifactReports: [] };
  const state = distill(e, truth);
  const validation = state.progress.filter(p => p.kind === 'current-validation');
  assert.ok(validation.some(v => /unknown/.test(v.text)), 'no current test rerun -> validation stays unknown');
  assert.ok(!state.progress.some(p => p.kind === 'current-validation' && /passed/.test(p.text)), 'assistant claim must not become current validation truth');
});

test('Claude handoff freshness: capture/hash/artifact update when complete records appended; trailing partial excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fresh-'));
  const sessionFile = path.join(dir, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify(userText(null, 'First requirement')) + '\n');
  const meta = { id: 'S', nativeSessionId: 'S', canonicalId: 'claude:src:S', sourceId: 'src', agentType: 'claude', cwd: dir, originalPath: sessionFile };
  const snapshotPath = snapshotPathForCanonicalSession(dir, meta.canonicalId);
  const artifact = () => createHandoffArtifact({ session: meta, canonicalId: meta.canonicalId, rootDir: dir, workspace: dir, captureSession, generateHandoff: generateClaudeHandoff });

  const first = artifact();
  assert.match(first.markdown, /First requirement/);
  const firstHash = first.capture.sha256;

  // Append a complete assistant turn AND a genuinely partial trailing user line (no newline → excluded).
  const full = JSON.stringify({ ...userText('u0', 'Third requirement appended fully'), uuid: 'z', timestamp: SESSION_TS });
  fs.appendFileSync(sessionFile, JSON.stringify(assistantText('u0', 'Second turn evidence')) + '\n' + full.slice(0, -1));
  const second = artifact();
  assert.notEqual(second.capture.sha256, firstHash);
  assert.match(second.markdown, /Second turn evidence/);
  assert.doesNotMatch(second.markdown, /Third requirement appended fully/, 'partial trailing line excluded');
  assert.equal(second.capture.canonicalId, 'claude:src:S');
  assert.equal(second.capture.nativeSessionId, 'S');

  // Complete the previously-partial trailing line -> it now becomes a full user requirement.
  fs.appendFileSync(sessionFile, '}' + '\n');
  const third = artifact();
  assert.notEqual(third.capture.sha256, second.capture.sha256);
  assert.match(third.markdown, /Third requirement appended fully/);
});

test('Claude adapter wiring: captureSession + generateHandoff + handoff capability exposed', () => {
  const claude = adapterFor('claude');
  assert.equal(typeof claude.captureSession, 'function');
  assert.equal(typeof claude.generateHandoff, 'function');
  assert.equal(typeof claude.readSessionSnapshots, 'function');
});

test('Claude evidence: SDK-injected control user messages are excluded from Goal candidates', () => {
  const e = writeSnapshot([
    userText(null, 'Implement CLIFirst-draft task'),
    userText('u0', '[Request interrupted by user]'),
    userText('u1', '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond.</local-command-caveat>'),
    userText('u2', '<command-name>/model</command-name>\n<command-message>model</command-message>'),
    userText('u3', '<local-command-stdout>Set model to claude-haiku-4-5</local-command-stdout>'),
    userText('u4', '完成剩下的工作'),
  ]);
  const reqs = e.nodes.filter(n => n.kind === 'User requirement').map(n => n.text);
  assert.ok(reqs.some(t => /CLIFirst-draft/.test(t)), 'real requirement kept');
  assert.ok(reqs.some(t => /完成剩下的工作/.test(t)), 'genuine short continuation kept');
  assert.ok(!reqs.some(t => /interrupted by user/i.test(t)), 'interrupt marker excluded');
  assert.ok(!reqs.some(t => /local-command/.test(t)), 'local-command wrapper excluded');
  assert.ok(!reqs.some(t => /command-name\/>\/model/.test(t)), 'slash-command envelope excluded');
});

async function withServer(app, action) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test('Claude Session Board Copy / Save: Claude row exposes handoff; Copy and Save share the exact Core markdown byte-equivalently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-board-'));
  const sessionFile = path.join(dir, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify(userText(null, 'Board handoff requirement')) + '\n' +
    JSON.stringify(assistantText('u0', 'Completed the board work.')) + '\n');
  const claudeMeta = { id: 'S', nativeSessionId: 'S', canonicalId: 'claude:src:S', sourceId: 'src', agentType: 'claude',
    cwd: dir, originalPath: sessionFile, label: 'Board session', displayTitle: 'Board session',
    capabilities: { sessions: true, handoff: true, apiUsage: false, quota: false, executionStatus: false, attentionStatus: false } };

  const app = createHandoffHttpAdapter({
    rootDir: os.tmpdir(),
    readRegistry: () => ({ version: 1, sources: [{ id: 'c', sourceId: 'c', type: 'codex', agentType: 'codex', path: dir, enabled: true, origin: 'auto', capabilities: {} }] }),
    writeRegistry: registry => registry,
    discoverSessions: async () => [claudeMeta],
    adapterResolver: type => type === 'codex' ? { agentType: 'codex', getSessionRevision: () => 'c', readSessionSnapshots: async () => ({ ok: true, snapshots: [claudeMeta] }) }
      : type === 'claude' ? { agentType: 'claude', getSessionRevision: () => 'cc', captureSession, generateHandoff: generateClaudeHandoff } : null,
  });

  await withServer(app, async origin => {
    const list = await (await fetch(`${origin}/api/sessions`)).json();
    const row = list.data.sessions.find(s => s.canonicalId === 'claude:src:S');
    assert.ok(row, 'Claude session row present');
    assert.equal(row.capabilities.handoff, true, 'Claude row exposes handoff -> Board shows Copy/Save');

    const generated = await (await fetch(`${origin}/api/handoff/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'claude:src:S', repo: dir }),
    })).json();
    assert.equal(generated.ok, true);
    assert.match(generated.data.markdown, /Board handoff requirement/);
    const markdown = generated.data.markdown;

    const saved = await (await fetch(`${origin}/api/handoff/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: dir, markdown }),
    })).json();
    assert.equal(saved.ok, true);
    const onDisk = fs.readFileSync(path.join(dir, '.margin', 'HANDOFF.md'), 'utf8');
    assert.equal(onDisk, markdown, 'Save bytes equal Copy markdown bytes');
  });
});
