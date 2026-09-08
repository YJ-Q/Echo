import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildEvidence } from '../src/core/handoff/evidence.js';
import { distill } from '../src/core/handoff/distiller.js';
import { observeFile, refreshRepoTruth, sha256 } from '../src/core/handoff/repo-truth.js';
import { unwrapExec, commandKinds } from '../src/core/handoff/exec.js';
import { renderSmartHandoff } from '../src/core/handoff/handoff.js';
import { captureSession, discoverSessions, readSessionSource } from '../src/core/handoff/session-source.js';
import { createHandoffArtifact, snapshotPathForCanonicalSession } from '../src/core/handoff/handoffArtifact.js';

// Fixture helpers — plain objects, no phase0Evidence coupling
const source = entries => ({
  capture: { snapshotPath: 'fixture.jsonl', sha256: 'fixture', capturedAt: '2026-01-01T00:00:00Z' },
  session: { cwd: 'D:\\fixture' },
  records: entries.map((payload, i) => ({ line: i + 1, event: { type: 'response_item', payload } })),
});
const call = (id, input) => ({ type: 'custom_tool_call', name: 'exec', call_id: id, input });
const result = (id, ...values) => ({ type: 'custom_tool_call_output', call_id: id,
  output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' },
    ...values.map(v => ({ type: 'input_text', text: JSON.stringify(v) }))] });
const truth = () => ({ capturedAt: 'now', workspace: 'D:\\fixture', stableDuringObservation: true,
  git: { status: 'available', branch: 'main', head: 'abc', changes: [] }, files: [], patchChecks: [], artifactReports: [] });

test('mixed patch {} and failed shell do not inherit outer Script completed success', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.apply_patch("*** Begin Patch\\n*** Add File: a.js\\n+x\\n*** End Patch")); text(await tools.exec_command({cmd:"npm test"}));'),
    result('a', {}, { exit_code: 1, output: 'failed' })]));
  assert.equal(e.operations[0].status, 'unknown');
  assert.equal(e.operations[1].status, 'failed');
  assert.ok(e.nodes.some(n => n.kind === 'Test result' && n.status === 'failed'));
});

test('missing result and duplicate call IDs never get guessed associations', () => {
  const missing = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm test"}));')]));
  assert.equal(missing.operations[0].confidence, 'Uncertain');
  const duplicate = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm test"}));'),
    call('a', 'text(await tools.exec_command({cmd:"npm test"}));'), result('a', { exit_code: 0 })]));
  assert.equal(duplicate.coverage.matchedCalls, 0);
  assert.ok(duplicate.operations.every(o => o.status === 'unknown'));
});

test('JSON with braces and escaped quotes retains output pairing', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"one"})); text(await tools.exec_command({cmd:"two"}));'),
    result('a', { exit_code: 0, output: 'hello { \\" }' }, { exit_code: 2, output: 'next' })]));
  assert.deepEqual(e.operations.map(o => o.status), ['succeeded', 'failed']);
});

test('parallel allSettled results are associated by emission order, not completion order', () => {
  const e = buildEvidence(source([call('a', 'const r=await Promise.allSettled([tools.exec_command({cmd:"first"}),tools.exec_command({cmd:"second"})]); r.forEach(text);'),
    result('a', { status: 'fulfilled', value: { exit_code: 1 } }, { status: 'fulfilled', value: { exit_code: 0 } })]));
  assert.deepEqual(e.operations.map(o => [o.command, o.status]), [['first', 'failed'], ['second', 'succeeded']]);
});

test('simple local-variable exec emission is statically recovered without inventing an exit status', () => {
  const e = buildEvidence(source([call('a', 'const r = await tools.exec_command({cmd:"npm test"}); text(r.output);'),
    { type: 'custom_tool_call_output', call_id: 'a', output: [{ type: 'input_text', text: 'Script completed\nOutput:\nall tests passed\n' }] }]));
  assert.equal(e.operations[0].command, 'npm test');
  assert.equal(e.operations[0].mapping, 'static local-variable output emission');
  assert.equal(e.operations[0].status, 'unknown');
});

test('native CommandExecution is direct historical validation evidence, never current validation', () => {
  const input = source([]);
  input.records.push({ line: 9, event: { type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'CommandExecution', parsed_cmd: [{ cmd: 'npm test' }], cwd: 'file:///D:/fixture', exit_code: 0, stdout: 'ok', status: 'completed',
  } } } });
  const e = buildEvidence(input);
  assert.deepEqual(e.operations.map(op => [op.id, op.command, op.status]), [['native:L9', 'npm test', 'succeeded']]);
  const s = distill(e, truth());
  assert.ok(s.progress.some(item => item.kind === 'historical-validation' && /exited 0/.test(item.text)));
  assert.ok(s.progress.some(item => item.kind === 'current-validation' && /unknown/.test(item.text)));
});

test('terminal labelled reports preserve historical report, pending, blockers, and follow-up without prose completion promotion', () => {
  const e = buildEvidence(source([{ type: 'message', role: 'assistant', content: [{ text: `Terminal conclusion:\nReport: PASS — implementation and focused checks completed.\nPending: Run the packaging smoke.\nBlockers: Missing host Python.\nRecommended follow-up: Restore Python, then run the bounded package check.` }] }]));
  const s = distill(e, truth());
  assert.equal(s.historicalReport[0].text, 'PASS — implementation and focused checks completed.');
  assert.deepEqual(s.historicalPending.map(item => item.text), ['Run the packaging smoke.', 'Missing host Python.']);
  assert.match(s.historicalFollowUp[0].text, /Restore Python/);
  assert.equal(s.completed.length, 0);
  const md = renderSmartHandoff(s, truth());
  assert.match(md, /## Historical Report/);
  assert.match(md, /\*\*Inferred · Historical\*\*/);
  assert.doesNotMatch(md, /## Current Applicability/);
});

test('terminal final-answer excerpt retains a bounded research outcome and pending plan as historical reporting', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', phase: 'commentary', content: [{ text: 'Inspecting sources.' }] },
    { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: `## Findings\nResearch identified the native source and recommended a bounded implementation model.\n\n## Recommended implementation\nImplement the read-only slice with fixtures after reconciling the current repository.\n\n## Verdict\nPASS — enough evidence for implementation.` }] },
  ]));
  const s = distill(e, truth());
  const report = s.historicalReport.find(item => item.kind === 'historical-terminal-report');
  assert.ok(report);
  assert.match(report.text, /Research identified the native source/);
  assert.match(report.text, /Implement the read-only slice/);
  assert.match(report.text, /PASS — enough evidence/);
  assert.equal(report.temporalScope, 'historical');
  assert.match(report.basis, /not independent completion or current repository truth/);
});

test('truncated output cannot be repaired by borrowing a later success', () => {
  const r = result('a', { exit_code: 0 });
  r.output.splice(1, 0, { type: 'input_text', text: 'Warning: truncated output\n{"exit_code":' });
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));'), r]));
  assert.ok(e.operations.every(o => o.status === 'unknown'));
});

test('dynamic code and unexecuted branches never run during static extraction', () => {
  globalThis.phase1Executed = false;
  const p = unwrapExec('globalThis.phase1Executed=true; if(false){text(await tools.exec_command({cmd:"danger"}));}');
  assert.equal(globalThis.phase1Executed, false);
  assert.equal(p.reliable, false);
  assert.equal(p.slots.length, 0);
  const q = unwrapExec('text(await tools.exec_command({cmd:process.env.SECRET}));');
  assert.equal(q.slots[0].args, undefined);
  assert.ok(q.slots[0].unresolved);
  delete globalThis.phase1Executed;
});

test('tool-looking text inside a shell string is not promoted to a real nested call', () => {
  const p = unwrapExec('text(await tools.exec_command({cmd:"echo tools.apply_patch(123)"}));');
  assert.equal(p.slots.length, 1);
  assert.equal(p.slots[0].name, 'exec_command');
});

test('PTY execution joins a later write_stdin result, initial yield is not success', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm test"}));'), result('a', { session_id: 42, output: '' }),
    call('b', 'text(await tools.write_stdin({session_id:42,chars:""}));'), result('b', { exit_code: 0, output: 'passed' })]));
  assert.equal(e.operations[0].initialOutcome.status, 'running');
  assert.equal(e.operations[0].status, 'succeeded');
  assert.equal(e.operations[0].completionOperationId, 'call:L3/op1');
  assert.equal(e.nodes.find(n => n.kind === 'Test execution').status, 'succeeded');
});

test('PTY completion for a different handle cannot confirm a pending operation', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm test"}));'), result('a', { session_id: 42 }),
    call('b', 'text(await tools.write_stdin({session_id:43,chars:""}));'), result('b', { exit_code: 0 })]));
  assert.equal(e.operations[0].status, 'running');
  assert.equal(e.operations[0].completionOperationId, undefined);
});

test('test recognizer rejects documentation mentions in node -e and preserves real test commands', () => {
  assert.equal(commandKinds('node -e \'console.log("npm test")\'').test, false);
  for (const c of ['npm test', 'npm.cmd run test', 'node --test test/a.test.mjs', 'pytest -q'])
    assert.equal(commandKinds(c).test, true, c);
});

test('assistant success claim conflicts with actual failed test and never enters Completed', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm test"}));'), result('a', { exit_code: 1 }),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '所有测试全部通过，任务已完成。' }] }]));
  const s = distill(e, truth());
  assert.equal(s.completed.length, 0);
  assert.ok(s.openIssues.some(i => i.confidence === 'Uncertain' && i.text.includes('Assistant')));
});

test('research-only progress keeps a research report separate from implementation intent and validation unknown', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Research stop verdict: STOP — enough evidence to implement. Implement Slice 2.3 using Option B.' }] },
  ]));
  const s = distill(e, truth());
  const md = renderSmartHandoff(s, truth());
  assert.deepEqual(s.progress.map(p => [p.kind, p.confidence, p.temporalScope]), [
    ['assistant-report', 'Inferred', 'historical'],
    ['historical-validation', 'Uncertain', 'historical'],
    ['current-validation', 'Uncertain', 'current'],
  ]);
  assert.match(md, /Assistant-reported research milestone: Research stop verdict/);
  assert.match(md, /Historical validation: unknown/);
  assert.match(md, /Current validation: unknown/);
  assert.match(md, /## Historical Intent/);
  assert.doesNotMatch(md, /Slice 2\.3 completed/i);
});

test('implementation progress aggregates historical tests and structured edit success without inferring task completion', () => {
  const commands = Array.from({ length: 5 }, (_, i) => `text(await tools.exec_command({cmd:"node --test test/focused-${i}.test.js"}));`).join(' ');
  const e = buildEvidence(source([
    call('edit', 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: src/foo.js\\n+x\\n*** End Patch"));'),
    result('edit', 'Success. Updated the following files:\nM src/foo.js'),
    call('tests', commands), result('tests', ...Array.from({ length: 5 }, () => ({ exit_code: 0 }))),
    { type: 'message', role: 'assistant', content: [{ text: 'Phase 1 Distiller PoC complete.' }] },
  ]));
  const t = truth();
  t.files = [{ id: 'file:src/foo.js', path: 'D:\\fixture\\src\\foo.js', status: 'exists', confidence: 'Confirmed',
    targetProvenance: [{ operationId: 'call:L1/op1' }] }];
  const s = distill(e, t);
  const md = renderSmartHandoff(s, t);
  assert.ok(s.progress.some(p => p.kind === 'assistant-report' && p.confidence === 'Inferred' && p.evidence[0] === 'claim:L5'));
  assert.ok(s.progress.some(p => p.kind === 'historical-validation' && /5 focused test commands exited 0/.test(p.text) && p.confidence === 'Confirmed'));
  assert.ok(s.progress.some(p => p.kind === 'structured-work' && /no explicit historical result/.test(p.text) && p.confidence === 'Uncertain'));
  assert.ok(s.progress.some(p => p.kind === 'current-corroboration' && p.temporalScope === 'current'));
  assert.match(md, /Current validation: unknown/);
  assert.doesNotMatch(md, /Phase 1 confirmed complete/i);
});

test('a later negating report supersedes an earlier assistant milestone but does not erase historical test failure', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Implementation complete.' }] },
    call('test', 'text(await tools.exec_command({cmd:"npm test"}));'), result('test', { exit_code: 1 }),
    { type: 'message', role: 'assistant', content: [{ text: 'A regression remains; implementation is not complete.' }] },
  ]));
  const s = distill(e, truth());
  assert.ok(!s.progress.some(p => p.kind === 'assistant-report'));
  assert.ok(s.progress.some(p => p.kind === 'historical-validation' && /failed/.test(p.text) && p.confidence === 'Confirmed'));
});

test('next step recovers the latest terminal implementation commitment with its claim evidence', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'I’m checking parser metadata.' }] },
    { type: 'message', role: 'assistant', content: [{ text: 'Research complete. Implement Slice 2.3 using Option B.' }] },
  ]));
  const s = distill(e, truth());
  assert.deepEqual(s.nextStep[0], {
    confidence: 'Inferred', text: 'Implement Slice 2.3 using Option B', evidence: ['claim:L2'],
    basis: 'Next action inferred from the latest explicit assistant implementation/handoff commitment',
  });
});

test('an explicit historical intent is not rendered as a current next step when no structured target exists', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Implement Slice 2.3 using Option B.' }] },
  ]));
  const t = truth();
  t.targetLinkage = { status: 'unknown', scope: 'No structured repo targets available for reconciliation', count: 0 };
  const md = renderSmartHandoff(distill(e, t), t);

  assert.match(md, /## Historical Intent/);
  assert.match(md, /\*\*Inferred\*\* Implement Slice 2\.3 using Option B/);
  assert.match(md, /## Current Applicability/);
  assert.match(md, /\*\*Unknown\*\* No structured repo targets are available for reconciliation\./);
  assert.doesNotMatch(md, /## 下一步/);
  assert.doesNotMatch(md, /completed|incomplete|stale|superseded|safe to execute/i);
});

test('current applicability renders structured target observations without inferring action completion', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Implement the selected option.' }] },
  ]));
  const t = truth();
  t.targetLinkage = { status: 'available', scope: 'Structured historical edit targets linked to their current file observations', count: 2 };
  t.files = [
    { path: 'D:\\fixture\\src\\exists.js', status: 'exists', bytes: 42, sha256: 'current-hash', modifiedAt: '2026-01-02T00:00:00Z', targetProvenance: [{ operationId: 'call:L10/op1' }] },
    { path: 'D:\\fixture\\src\\missing.js', status: 'missing', targetProvenance: [{ operationId: 'call:L10/op2' }] },
  ];
  const md = renderSmartHandoff(distill(e, t), t);

  assert.match(md, /call:L10\/op1 → `src\\exists\.js` — exists; 42 bytes; SHA-256 current-hash/);
  assert.match(md, /call:L10\/op2 → `src\\missing\.js` — currently missing/);
  assert.doesNotMatch(md, /action (?:is )?(?:completed|failed|stale)|already implemented/i);
});

test('a later explicit replacement action supersedes an earlier implementation commitment', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Implement A.' }] },
    { type: 'message', role: 'assistant', content: [{ text: 'Do not implement A yet; Research B first.' }] },
  ]));
  const s = distill(e, truth());
  assert.equal(s.nextStep[0].text, 'Research B first');
  assert.deepEqual(s.nextStep[0].evidence, ['claim:L2']);
});

test('a later direct implementation commitment also supersedes an earlier terminal handoff', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Research complete. Implement A.' }] },
    { type: 'message', role: 'assistant', content: [{ text: 'Implement B.' }] },
  ]));
  const s = distill(e, truth());
  assert.equal(s.nextStep[0].text, 'Implement B');
  assert.deepEqual(s.nextStep[0].evidence, ['claim:L2']);
});

test('next step retains the generic fallback when claims have no explicit future commitment', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'Tests passed. Investigation complete. Current state looks correct.' }] },
  ]));
  const s = distill(e, truth());
  assert.match(s.nextStep[0].text, /先阅读已存在产物/);
  assert.notDeepEqual(s.nextStep[0].evidence, ['claim:L1']);
});

test('terminal implementation handoff wins over earlier interim activity', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: 'I’ll inspect file X.' }] },
    { type: 'message', role: 'assistant', content: [{ text: 'Implementation handoff: modify Y and run focused tests.' }] },
  ]));
  const s = distill(e, truth());
  assert.equal(s.nextStep[0].text, 'modify Y and run focused tests');
  assert.deepEqual(s.nextStep[0].evidence, ['claim:L2']);
});

test('a terminal handoff section outranks earlier implementation substeps in the same claim', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: `Proposed implementation:

- Add bounded helper.
- Modify session filtering.
- Run focused tests.

Implementation handoff:

Implement Slice 2.3 using Option B.` }] },
  ]));
  const s = distill(e, truth());
  assert.deepEqual(s.nextStep[0], {
    confidence: 'Inferred', text: 'Implement Slice 2.3 using Option B', evidence: ['claim:L1'],
    basis: 'Next action inferred from the latest explicit assistant implementation/handoff commitment',
  });
});

test('a numbered Markdown implementation handoff restores the top-level action from the real claim structure', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: `## 6. Proposed Slice 2.3

- [session-source.js](https://example.invalid/session-source.js)
  - Add a bounded, fail-open helper that reads only the first
    \`session_meta\` JSONL record from \`originalPath\`.
  - Reuse/align with existing \`findThreadSource()\` semantics.

## 10. Implementation handoff

Implement Slice 2.3 in \`src/core/handoff/session-source.js\` using Option B.` }] },
  ]));
  const s = distill(e, truth());
  assert.ok(s.nextStep[0].text.startsWith('Implement Slice 2.3'));
  assert.doesNotMatch(s.nextStep[0].text, /^Add a bounded/u);
  assert.equal(s.nextStep[0].confidence, 'Inferred');
  assert.deepEqual(s.nextStep[0].evidence, ['claim:L1']);
});

test('a terminal handoff section remains top-level when it follows multiple implementation bullets', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ text: `Recommended implementation:

- Add helper.
- Modify file.
- Run focused tests.

Terminal handoff:

Implement the selected option.` }] },
  ]));
  const s = distill(e, truth());
  assert.equal(s.nextStep[0].text, 'Implement the selected option');
  assert.deepEqual(s.nextStep[0].evidence, ['claim:L1']);
});

test('failed attempt followed by same-command success is a resolved retry, not a forbidden approach', () => {
  const e = buildEvidence(source([call('a', 'text(await tools.exec_command({cmd:"npm install"}));'), result('a', { exit_code: 1 }),
    call('b', 'text(await tools.exec_command({cmd:"npm install"}));'), result('b', { exit_code: 0 })]));
  const s = distill(e, truth());
  assert.equal(s.failed[0].resolvedBy, 'call:L3/op1');
  assert.equal(s.completed.length, 1);
});

test('missing file contradicts creation claim; stored test report does not become a fresh passing test', () => {
  const e = buildEvidence(source([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a.js 已创建成功。' }] }]));
  const t = truth();
  t.files.push({ id: 'file:a', path: path.resolve('a.js'), status: 'missing', confidence: 'Confirmed' },
    { id: 'file:report', path: path.resolve('report.json'), status: 'exists', bytes: 100, confidence: 'Confirmed' });
  t.artifactReports.push({ fileEvidenceId: 'file:report', reportedPasses: 15, reportedAt: 'old', sourceHashMatches: false });
  const s = distill(e, t);
  assert.ok(s.openIssues.some(i => i.text.includes('文件当前缺失')));
  assert.equal(s.tests.find(t => t.confidence === 'Inferred').status, undefined);
  assert.equal(s.completed.length, 0);
});

test('workspace refresh observes changed/deleted files; proposed patch does not overwrite repo truth', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-handoff-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'current\n');
  const e = { operations: [{ id: 'edit', status: 'unknown', edits: [{ action: 'add', path: file, added: ['old'], removed: [], context: [] }] }], source: { sha256: 'x' } };
  const first = refreshRepoTruth(dir, e);
  assert.equal(first.patchChecks[0].exactAdd, false);
  const firstHash = first.files[0].sha256;
  fs.writeFileSync(file, 'new\n');
  const second = refreshRepoTruth(dir, e);
  assert.notEqual(second.files[0].sha256, firstHash);
  fs.unlinkSync(file);
  assert.equal(refreshRepoTruth(dir, e).files[0].status, 'missing');
  assert.equal(observeFile(dir, path.resolve(dir, '../outside')).status, 'out-of-scope');
});

test('structured edit target retains operation provenance on its current repo observation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-repo-target-'));
  const file = path.join(dir, 'src', 'example.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export const current = true;\n');
  const evidence = { source: { sha256: 'source' }, operations: [{ id: 'call:L42/op1', evidence: [{ path: 'session.jsonl', sha256: 'source', line: 42 }],
    edits: [{ action: 'edit', path: 'src/example.js', added: [], removed: [], context: [] }] }] };

  const observed = refreshRepoTruth(dir, evidence);
  const currentFile = observed.files.find(item => item.path === file);
  assert.equal(observed.targetLinkage.status, 'available');
  assert.equal(observed.targetLinkage.count, 1);
  assert.equal(currentFile.status, 'exists');
  assert.equal(currentFile.targetProvenance[0].operationId, 'call:L42/op1');
  assert.equal(currentFile.targetProvenance[0].historicalPath, 'src/example.js');
  assert.deepEqual(currentFile.targetProvenance[0].evidence, evidence.operations[0].evidence);
  assert.equal(currentFile.targetProvenance[0].fileEvidenceId, currentFile.id);

  const firstHash = currentFile.sha256;
  fs.writeFileSync(file, 'export const current = false;\n');
  const changed = refreshRepoTruth(dir, evidence).files.find(item => item.path === file);
  assert.notEqual(changed.sha256, firstHash);
  assert.equal(changed.targetProvenance[0].operationId, 'call:L42/op1');
});

test('assistant claim and dirty repo state do not create a reconciliation target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-no-repo-target-'));
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Margin test']);
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'baseline\n');
  git(['add', 'unrelated.txt']);
  git(['commit', '--quiet', '-m', 'baseline']);
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'dirty current content\n');
  const evidence = { source: { sha256: 'source' }, operations: [], nodes: [{ id: 'claim:L1', kind: 'Assistant claim', text: 'Implement Slice 2.3 using Option B' }] };

  const observed = refreshRepoTruth(dir, evidence);
  assert.deepEqual(observed.targetLinkage, {
    status: 'unknown', scope: 'No structured repo targets available for reconciliation', count: 0,
  });
  assert.deepEqual(observed.files, []);
  assert.deepEqual(observed.patchChecks, []);
  assert.equal(observed.git.changes.length, 1);
  assert.equal(observed.git.changes[0].path, 'unrelated.txt');
});

test('distilled state evidence references resolve against evidence nodes and operations', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'user', content: [{ text: 'implement feature X' }] },
    call('a', 'text(await tools.exec_command({cmd:"npm test"}));'),
    result('a', { exit_code: 0 }),
  ]));
  const s = distill(e, truth());
  const allIds = new Set([...e.nodes.map(n => n.id), ...e.operations.map(o => o.id), 'repo:git', 'coverage:source']);
  for (const item of [...s.currentState, ...s.completed, ...s.failed, ...s.tests, ...s.progress, ...s.nextStep, ...s.openIssues]) {
    for (const ref of item.evidence ?? []) {
      assert.ok(allIds.has(ref) || ref.startsWith('file:') || ref.startsWith('repo:') || ref.startsWith('coverage:'),
        `Unresolvable evidence reference: ${ref}`);
    }
  }
  assert.ok(s.goal.length > 0);
  assert.equal(s.goal[0].confidence, 'Inferred');
});

test('smart handoff renders without empty sections and contains goal and current state', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'user', content: [{ text: 'add tests for auth module' }] },
    call('a', 'text(await tools.exec_command({cmd:"npm test"}));'),
    result('a', { exit_code: 0 }),
  ]));
  const t = truth();
  const s = distill(e, t);
  const md = renderSmartHandoff(s, t);
  assert.ok(md.includes('## 目标'));
  assert.ok(md.includes('## 当前状态'));
  assert.ok(md.includes('add tests for auth module'));
  // no empty section markers
  assert.ok(!md.includes('未提取到有依据的信息'));
});

test('pipeline source boundary accepts plain records without phase0Evidence envelope', () => {
  // Verify buildEvidence throws clearly with wrong input, not silently produces garbage
  assert.throws(() => buildEvidence({}), /Session source required/);
  assert.throws(() => buildEvidence({ records: [], capture: null }), /Session source required/);
  // Correct input succeeds
  const e = buildEvidence(source([]));
  assert.equal(e.schemaVersion, 'margin.evidence.v1');
  assert.equal(e.nodes.length, 0);
  assert.equal(e.operations.length, 0);
});

test('goal collapses to the current objective instead of listing every historical requirement', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'user', content: [{ text: 'first: build the login page with full details about validation and layout' }] },
    { type: 'message', role: 'user', content: [{ text: 'second: scrap that, build a signup page instead with full details about validation and layout' }] },
  ]));
  const s = distill(e, truth());
  // A later explicit requirement supersedes the earlier one; only one goal remains.
  assert.equal(s.goal.length, 1);
  assert.ok(s.goal[0].text.startsWith('second:'));
});

test('a short trailing message cannot stand alone as the goal; the prior requirement is retained with it', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'user', content: [{ text: 'implement the export feature with CSV and JSON output formats' }] },
    { type: 'message', role: 'user', content: [{ text: '继续' }] },
  ]));
  const s = distill(e, truth());
  assert.equal(s.goal.length, 2);
  assert.ok(s.goal.some(g => g.text.includes('export feature')));
  assert.ok(s.goal.some(g => g.text === '继续'));
});

test('decisions are omitted entirely without decision evidence; no placeholder field or section', () => {
  const e = buildEvidence(source([
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '进展说明，无实际决策证据。' }] },
  ]));
  const t = truth();
  const s = distill(e, t);
  assert.equal(s.decisions, undefined);
  const md = renderSmartHandoff(s, t);
  assert.ok(!md.includes('## Decisions'));
  assert.ok(!md.includes('未从执行事实自动推导技术决策原因'));
});

test('captureSession recovers from a snapshot with a missing or corrupt .capture.json instead of crashing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-capture-'));
  const original = path.join(dir, 'rollout-original.jsonl');
  fs.writeFileSync(original, '{"type":"a"}\n{"type":"b"}\n');
  const snapshotPath = path.join(dir, 'session-x.jsonl');
  const meta = { id: 'x', cwd: dir, originalPath: original };

  const first = captureSession(meta, snapshotPath);
  assert.equal(fs.existsSync(snapshotPath), true);
  assert.equal(fs.existsSync(snapshotPath + '.capture.json'), true);

  // Snapshot intact, sidecar deleted — must re-capture cleanly, not throw.
  fs.unlinkSync(snapshotPath + '.capture.json');
  const second = captureSession(meta, snapshotPath);
  assert.equal(second.sha256, first.sha256);
  assert.equal(fs.existsSync(snapshotPath + '.capture.json'), true);

  // Snapshot intact, sidecar corrupt — must re-capture cleanly, not throw.
  fs.writeFileSync(snapshotPath + '.capture.json', '{not valid json');
  const third = captureSession(meta, snapshotPath);
  assert.equal(third.sha256, first.sha256);
  const sidecar = JSON.parse(fs.readFileSync(snapshotPath + '.capture.json', 'utf8'));
  assert.equal(sidecar.sha256, first.sha256);
});

test('user generation uses a Windows-safe canonical snapshot name and freshly freezes appended complete records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-fresh-capture-'));
  const original = path.join(dir, 'rollout.jsonl');
  const canonicalId = 'codex:source:session:with:colons';
  fs.writeFileSync(original, '{"type":"initial"}\n');
  const session = { id: 'session:with:colons', nativeSessionId: 'session:with:colons', canonicalId, sourceId: 'source', agentType: 'codex', cwd: dir, originalPath: original };
  const snapshotPath = snapshotPathForCanonicalSession(dir, canonicalId);
  assert.doesNotMatch(path.basename(snapshotPath), /:/);

  const artifact = () => createHandoffArtifact({ session, canonicalId, rootDir: dir, workspace: dir, captureSession,
    generateHandoff: (capture) => ({ markdown: fs.readFileSync(capture.snapshotPath, 'utf8'), resumeSummary: {} }) });
  const first = artifact();
  fs.appendFileSync(original, '{"type":"complete-new-evidence"}\n{"type":"partial');
  const second = artifact();
  assert.notEqual(second.capture.sha256, first.capture.sha256);
  assert.match(second.markdown, /complete-new-evidence/);
  assert.doesNotMatch(second.markdown, /partial/);
  assert.equal(second.capture.canonicalId, canonicalId);
  assert.equal(second.capture.nativeSessionId, session.nativeSessionId);

  fs.appendFileSync(original, '-record"}\n');
  const third = artifact();
  assert.notEqual(third.capture.sha256, second.capture.sha256);
  assert.match(third.markdown, /partial-record/);
});

test('session source exposes discovery independent of a single --session id, ready for a future picker', () => {
  // discoverSessions accepts an optional { limit } so a "recent sessions" list and a
  // single-session lookup share the same call; captureSession/readSessionSource take the
  // chosen session's metadata, not a CLI flag, so generateHandoff(session) does not depend
  // on argv shape.
  assert.equal(typeof discoverSessions, 'function');
  assert.equal(discoverSessions.length, 1); // (codexHome, { limit } = {}) — second param has a default, doesn't count toward .length
  assert.equal(typeof captureSession, 'function');
  assert.equal(typeof readSessionSource, 'function');
});
