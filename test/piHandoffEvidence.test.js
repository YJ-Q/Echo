import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readPiSessionSource } from '../src/agents/pi/piSessionSource.js';
import { buildPiEvidence } from '../src/agents/pi/piEvidence.js';
import { generatePiHandoff } from '../src/agents/pi/piHandoff.js';
import { distill } from '../src/core/handoff/distiller.js';
import { captureSession } from '../src/core/handoff/session-source.js';
import { createHandoffArtifact, snapshotPathForCanonicalSession } from '../src/core/handoff/handoffArtifact.js';
import { createHandoffHttpAdapter } from '../src/core/handoff/httpAdapter.js';
import { adapterFor } from '../src/agents/adapters.js';

//
// Fixture helpers — build a real Pi JSONL snapshot + hash-verified capture.
//
const SESSION_TS = '2026-01-01T00:00:00.000Z';
const header = (id = 'S') => ({ type: 'session', version: 3, id, timestamp: SESSION_TS, cwd: 'D:\\fixture' });
const rec = (type, id, parent, fields = {}) => ({ type, id, parentId: parent ?? null, timestamp: SESSION_TS, ...fields });
const userMessage = (id, parent, text) => rec('message', id, parent, { message: { role: 'user', content: [{ type: 'text', text }] } });
const assistantMessage = (id, parent, text) => rec('message', id, parent, { message: { role: 'assistant', content: [{ type: 'text', text }] } });

function writeSnapshot(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-evidence-'));
  const snapshotPath = path.join(dir, 'session.jsonl');
  const raw = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(snapshotPath, raw);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const capture = { snapshotPath, sha256, capturedAt: new Date().toISOString(), originalPath: snapshotPath,
    sessionId: 'S', canonicalId: 'pi:src:S', sourceId: 'src', agentType: 'pi', nativeSessionId: 'S', cwd: 'D:\\fixture' };
  return buildPiEvidence(readPiSessionSource(capture));
}

test('Pi evidence: only the current active branch enters evidence; abandoned siblings are excluded', () => {
  const records = [
    header(),
    userMessage('A1', null, 'Build feature X with focused tests'),
    assistantMessage('A2', 'A1', 'checking the approach'),
    userMessage('B1', 'A2', 'abandoned alternative plan'),
    assistantMessage('B2', 'B1', 'abandoned work claim'),
    userMessage('A3', 'A2', 'continue'),
    assistantMessage('A4', 'A3', 'Done implementing X and its focused checks.'),
  ];
  const e = writeSnapshot(records);
  const reqs = e.nodes.filter(n => n.kind === 'User requirement').map(n => n.text);
  const claims = e.nodes.filter(n => n.kind === 'Assistant claim').map(n => n.text);
  assert.ok(reqs.some(t => /Build feature X/.test(t)));
  assert.ok(reqs.some(t => t === 'continue'));
  assert.ok(!reqs.some(t => /abandoned alternative/.test(t)), 'abandoned sibling requirement must not enter evidence');
  assert.ok(claims.some(t => /Done implementing X/.test(t)));
  assert.ok(!claims.some(t => /abandoned work claim/.test(t)), 'abandoned sibling claim must not enter evidence');
  assert.equal(e.coverage.activeLeafId, 'A4');
  assert.ok(e.coverage.rawRecords >= e.coverage.activeBranchRecords);
});

test('Pi evidence: compaction represents folded history once — no duplicated pre-compaction content', () => {
  const records = [
    header(),
    userMessage('M1', null, 'early context that gets compacted away'),
    assistantMessage('M2', 'M1', 'early work 1'),
    rec('compaction', 'C', 'M2', { summary: 'Compacted early work', firstKeptEntryId: 'M2', tokensBefore: 100 }),
    userMessage('M3', 'C', 'later real task'),
    assistantMessage('M4', 'M3', 'did the real task with tests'),
  ];
  const e = writeSnapshot(records);
  const claims = e.nodes.filter(n => n.kind === 'Assistant claim').map(n => n.text);
  const ctxs = e.nodes.filter(n => n.kind === 'Internal context/control').map(n => n.scope);
  assert.ok(claims.some(t => /did the real task/.test(t)), 'post-compaction assistant claim present');
  assert.ok(!claims.some(t => /early context/.test(t)), 'folded pre-compaction user requirement must not be enumerated');
  assert.equal(ctxs.filter(s => /compaction/i.test(s)).length, 1, 'compaction summary appears exactly once');
});

test('Pi evidence: tool pairings — success, isError, truncated, and unmatched/in-flight', () => {
  const toolCall = (callId, parent, args) => rec('message', `assist-${callId}`, parent, {
    message: { role: 'assistant', content: [{ type: 'toolCall', id: callId, name: callId === 'c3' ? 'read' : 'edit', arguments: args }] } });
  const toolResult = (callId, parent, { isError, truncated }) => rec('message', `res-${callId}`, parent, {
    timestamp: SESSION_TS, message: { role: 'toolResult', toolCallId: callId, toolName: callId === 'c3' ? 'read' : 'edit', isError,
      details: truncated ? { truncation: { truncated: true } } : undefined,
      content: [{ type: 'text', text: truncated ? 'very long output' : 'ok' }] } });

  // One linear parentId chain so every call is on the current active branch.
  const e = writeSnapshot([
    header(),
    toolCall('c1', null, { path: 'D:\\fixture\\a.js', edits: [{ oldText: 'x', newText: 'y' }] }),
    toolResult('c1', 'assist-c1', { isError: false, truncated: false }),
    toolCall('c2', 'res-c1', { path: 'D:\\fixture\\b.js', edits: [{ oldText: '1', newText: '2' }] }),
    toolResult('c2', 'assist-c2', { isError: true, truncated: false }),
    toolCall('c3', 'res-c2', { path: 'D:\\fixture\\big.txt' }),
    toolResult('c3', 'assist-c3', { isError: false, truncated: true }),
    toolCall('c4', 'res-c3', { path: 'D:\\fixture\\inflight.js', edits: [{ oldText: 'a', newText: 'b' }] }),
  ]);
  // success
  const c1 = e.operations.find(o => o.id === 'edit:c1');
  assert.equal(c1.status, 'succeeded');
  assert.equal(c1.edits[0].path, path.join('D:\\fixture\\a.js'));
  assert.ok(e.nodes.some(n => n.kind === 'File edit/write' && n.path === path.join('D:\\fixture\\a.js')));
  // isError -> failed
  assert.equal(e.operations.find(o => o.id === 'edit:c2').status, 'failed');
  assert.equal(e.operations.find(o => o.id === 'edit:c2').reason, 'Explicit isError in toolResult');
  // truncated result -> Tool result node marks truncation; read tool has no shell/edit operation
  const c3Result = e.nodes.find(n => n.kind === 'Tool result' && n.callId === 'c3');
  assert.match(c3Result.scope, /truncated/);
  assert.equal(e.operations.some(o => o.id === 'read:c3'), false);
  // unmatched / in-flight -> unknown, never success
  const c4 = e.operations.find(o => o.id === 'edit:c4');
  assert.equal(c4.status, 'unknown');
  assert.equal(c4.confidence, 'Uncertain');
  assert.match(c4.reason, /incomplete\/unmatched/);
  assert.equal(e.nodes.find(n => n.id === 'call:c4').resultIds.length, 0);
  assert.ok(e.warnings.some(w => /incomplete/.test(w.message)));
  assert.equal(e.coverage.matchedCalls, 3);
});

test('Pi evidence + Shared Core safety: assistant "tests pass" claim is not promoted to current validation', () => {
  const e = writeSnapshot([
    header(),
    userMessage('U1', null, 'Implement a feature and make tests pass'),
    assistantMessage('A1', 'U1', 'I ran the suite and all tests passed.'),
  ]);
  const truth = { capturedAt: 'now', workspace: 'D:\\fixture', stableDuringObservation: true,
    git: { status: 'available', branch: 'main', head: 'abc', changes: [] }, files: [], patchChecks: [], artifactReports: [] };
  const state = distill(e, truth);
  const validation = state.progress.filter(p => p.kind === 'current-validation');
  assert.ok(validation.some(v => /unknown/.test(v.text)), 'no current test rerun -> validation stays unknown');
  assert.ok(!state.progress.some(p => p.kind === 'current-validation' && /passed/.test(p.text)), 'assistant claim must not become current validation truth');
});

test('Pi handoff freshness: capture/hash/artifact update when complete records appended; trailing partial excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fresh-'));
  const sessionFile = path.join(dir, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify(header()) + '\n' + JSON.stringify(userMessage('U1', null, 'First requirement')) + '\n');
  const meta = { id: 'S', nativeSessionId: 'S', canonicalId: 'pi:src:S', sourceId: 'src', agentType: 'pi', cwd: dir, originalPath: sessionFile };
  const snapshotPath = snapshotPathForCanonicalSession(dir, meta.canonicalId);
  const artifact = () => createHandoffArtifact({ session: meta, canonicalId: meta.canonicalId, rootDir: dir, workspace: dir, captureSession, generateHandoff: generatePiHandoff });

  const first = artifact();
  assert.match(first.markdown, /First requirement/);
  const firstHash = first.capture.sha256;

  fs.appendFileSync(sessionFile, JSON.stringify(assistantMessage('A1', 'U1', 'Second turn evidence')) + '\n' + '{"type":"message","id":"partial"');
  const second = artifact();
  assert.notEqual(second.capture.sha256, firstHash);
  assert.match(second.markdown, /Second turn evidence/);
  assert.doesNotMatch(second.markdown, /Third requirement/);
  assert.equal(second.capture.canonicalId, 'pi:src:S');
  assert.equal(second.capture.nativeSessionId, 'S');

  // Complete the previously-partial trailing line as a new user requirement.
  fs.appendFileSync(sessionFile, ',"parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"Third requirement appended fully"}]}}\n');
  const third = artifact();
  assert.notEqual(third.capture.sha256, second.capture.sha256);
  assert.match(third.markdown, /Third requirement appended fully/);
});

test('Pi adapter wiring: captureSession + generateHandoff exposed on the Pi adapter', () => {
  const pi = adapterFor('pi');
  assert.equal(typeof pi.captureSession, 'function');
  assert.equal(typeof pi.generateHandoff, 'function');
  assert.equal(typeof pi.readSessionSnapshots, 'function');
});

async function withServer(app, action) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test('Pi Session Board Copy / Save: Pi row exposes handoff; Copy and Save share the exact Core markdown byte-equivalently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-board-'));
  const sessionFile = path.join(dir, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify(header()) + '\n' +
    JSON.stringify(userMessage('U1', null, 'Board handoff requirement')) + '\n' +
    JSON.stringify(assistantMessage('A1', 'U1', 'Completed the board work.')) + '\n');
  const piMeta = { id: 'S', nativeSessionId: 'S', canonicalId: 'pi:src:S', sourceId: 'src', agentType: 'pi',
    cwd: dir, originalPath: sessionFile, label: 'Board session', displayTitle: 'Board session',
    capabilities: { sessions: true, handoff: true, apiUsage: false, quota: false, executionStatus: false, attentionStatus: false } };

  const app = createHandoffHttpAdapter({
    rootDir: os.tmpdir(),
    readRegistry: () => ({ version: 1, sources: [{ id: 'c', sourceId: 'c', type: 'codex', agentType: 'codex', path: dir, enabled: true, origin: 'auto', capabilities: {} }] }),
    writeRegistry: registry => registry,
    discoverSessions: async () => [piMeta],
    adapterResolver: type => type === 'codex' ? { agentType: 'codex', getSessionRevision: () => 'c', readSessionSnapshots: async () => ({ ok: true, snapshots: [piMeta] }) }
      : type === 'pi' ? { agentType: 'pi', getSessionRevision: () => 'p', captureSession, generateHandoff: generatePiHandoff } : null,
  });

  await withServer(app, async origin => {
    const list = await (await fetch(`${origin}/api/sessions`)).json();
    const row = list.data.sessions.find(s => s.canonicalId === 'pi:src:S');
    assert.ok(row, 'Pi session row present');
    assert.equal(row.capabilities.handoff, true, 'Pi row exposes handoff -> Board shows Copy/Save');

    const generated = await (await fetch(`${origin}/api/handoff/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'pi:src:S', repo: dir }),
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