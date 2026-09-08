import { unwrapExec, decodeOutput, patchEdits, commandKinds, operationOutcome } from './exec.js';
import { normalizeUserRequirement } from './session-source.js';

// Codex's own recorder tags a thread's session_meta with thread_source: "user" for a normal
// end-user thread, or an internal value ("guardian_review", "subagent", "memory_consolidation",
// a feature name) for Codex's own internal threads (e.g. the risk-review pass that judges a
// planned action). A role="user"/"assistant" response_item inside an internal thread is Codex
// talking to itself, not a real user requirement or a real assistant progress claim, even
// though the record shape is identical. Absence of the field (older captures) is unknown, not
// "not user" — those sessions keep today's behavior.
const isInternalControlThread = (session) => Boolean(session?.threadSource) && session.threadSource !== 'user';

// source boundary: accepts { records, capture, session } — no phase0Evidence coupling
// records: [{ line, event }], capture: { snapshotPath, sha256, capturedAt, originalPath }, session: { cwd, threadSource }
export function buildEvidence({ records, capture, session }) {
  if (!records || !capture?.sha256) throw Error('Session source required: { records, capture, session }');
  const nodes = [], operations = [], warnings = [];
  const calls = records.filter(r => r.event?.type === 'response_item'
    && ['function_call', 'custom_tool_call'].includes(r.event.payload?.type));
  const results = records.filter(r => r.event?.type === 'response_item'
    && ['function_call_output', 'custom_tool_call_output'].includes(r.event.payload?.type));
  const pointer = (line, extra = {}) => ({ path: capture.snapshotPath, sha256: capture.sha256, line, ...extra });
  const internalThread = isInternalControlThread(session);
  // Native process records live outside response_item tool envelopes.
  for (const r of records) {
    const item = r.event?.type === 'event_msg' && r.event.payload?.type === 'item_completed' ? r.event.payload.item : null;
    if (item?.type !== 'CommandExecution') continue;
    const command = item.parsed_cmd?.find(entry => typeof entry?.cmd === 'string')?.cmd
      ?? (Array.isArray(item.command) ? item.command.join(' ') : item.command);
    const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined;
    const operation = { id: `native:L${r.line}`, name: 'CommandExecution', command,
      cwd: typeof item.cwd === 'string' ? item.cwd.replace(/^file:\/\//i, '') : session?.cwd,
      status: exitCode !== undefined ? (exitCode === 0 ? 'succeeded' : 'failed') : item.status === 'failed' ? 'failed' : 'unknown',
      confidence: exitCode !== undefined || item.status === 'failed' ? 'Confirmed' : 'Uncertain',
      reason: exitCode !== undefined ? `exit_code=${exitCode}` : 'Native command record has no explicit exit status',
      value: { exit_code: exitCode, output: item.stdout ?? item.aggregated_output ?? item.formatted_output },
      mapping: 'native CommandExecution', evidence: [pointer(r.line)], warnings: [] };
    if (typeof command === 'string') {
      operation.kinds = commandKinds(command);
      nodes.push({ id: `${operation.id}/shell`, kind: 'Shell command', confidence: 'Confirmed',
        scope: 'Native CommandExecution record; execution outcome tracked separately', operationId: operation.id, evidence: operation.evidence });
      if (operation.kinds.test) nodes.push({ id: `${operation.id}/test`, kind: 'Test execution', confidence: operation.confidence,
        operationId: operation.id, status: operation.status, evidence: operation.evidence });
    }
    operations.push(operation);
  }
  for (const r of records) {
    const p = r.event?.payload;
    if (r.event?.type !== 'response_item' || p?.type !== 'message') continue;
    const text = p.content?.filter(c => typeof c.text === 'string').map(c => c.text).join('\n') || '';
    if (internalThread && (p.role === 'user' || p.role === 'assistant')) {
      // Not a Goal candidate and not a completion claim — this whole thread is Codex judging
      // itself (e.g. a guardian_review pass), not the user talking to the coding agent.
      nodes.push({ id: `internal:L${r.line}`, kind: 'Internal context/control', confidence: 'Confirmed',
        scope: `Codex-internal thread (thread_source=${session.threadSource}); not a user requirement or assistant progress claim`,
        text, evidence: [pointer(r.line)] });
    } else if (p.role === 'user' && !/^\s*(?:<recommended_plugins>|<environment_context>|<permissions|# AGENTS\.md)/.test(text)) {
      const requirement = normalizeUserRequirement(text);
      if (!requirement) continue;
      nodes.push({ id: `requirement:L${r.line}`, kind: 'User requirement', confidence: 'Confirmed',
        scope: 'The request was made, not that it was completed', text: requirement, evidence: [pointer(r.line)] });
    } else if (p.role === 'assistant') {
      nodes.push({ id: `claim:L${r.line}`, kind: 'Assistant claim', confidence: 'Inferred',
        scope: 'Unverified narrative; not completion evidence', phase: p.phase, text, evidence: [pointer(r.line)] });
    }
  }
  const waitCalls = calls.filter(r => r.event.payload.name === 'wait');
  for (const call of calls) {
    const p = call.event.payload, id = `call:L${call.line}`;
    const matches = p.call_id ? results.filter(r => r.line > call.line && r.event.payload.call_id === p.call_id) : [];
    const duplicateId = calls.filter(r => r.event.payload.call_id === p.call_id).length > 1;
    const matched = matches.length === 1 && !duplicateId ? matches : [];
    nodes.push({ id, kind: 'Tool call', confidence: 'Confirmed', name: p.name, callId: p.call_id,
      evidence: [pointer(call.line)], resultIds: matched.map(r => `result:L${r.line}`) });
    for (const r of matched) nodes.push({ id: `result:L${r.line}`, kind: 'Tool result', confidence: 'Confirmed',
      callId: p.call_id, evidence: [pointer(r.line)], scope: 'Output observed; success evaluated per nested operation' });
    if (p.name === 'wait') continue;
    let args;
    try { args = JSON.parse(p.arguments); } catch { args = p.input; }
    const plan = p.name === 'exec' && typeof p.input === 'string' ? unwrapExec(p.input)
      : { slots: [{ name: p.name, args }], reliable: true, warnings: [] };
    const emitted = [], resultLines = matched.map(r => r.line);
    let decodeWarnings = [], pendingCell;
    for (const r of matched) {
      if (p.name === 'exec') {
        const decoded = decodeOutput(r.event.payload.output);
        emitted.push(...decoded.values); decodeWarnings.push(...decoded.warnings); pendingCell = decoded.cellId;
      } else {
        const value = r.event.payload.output;
        try { emitted.push(typeof value === 'string' ? JSON.parse(value) : value); } catch { emitted.push(value); }
      }
    }
    // Continuation waits may deliver the remaining emitted values of one exec cell.
    if (pendingCell) {
      for (const w of waitCalls.filter(w => w.line > call.line)) {
        let wa; try { wa = JSON.parse(w.event.payload.arguments); } catch { continue; }
        if (String(wa.cell_id) !== String(pendingCell)) continue;
        const wr = results.filter(r => r.line > w.line && r.event.payload.call_id === w.event.payload.call_id);
        if (wr.length !== 1) { decodeWarnings.push('Missing/ambiguous exec wait result'); continue; }
        const d = decodeOutput(wr[0].event.payload.output);
        emitted.push(...d.values); resultLines.push(wr[0].line); decodeWarnings.push(...d.warnings);
        if (d.completed) break;
      }
    }
    const propertyOnlyEmission = plan.slots.length > 0 && plan.slots.every(slot => slot?.emittedProperty) && matched.length === 1;
    // An emitted `.output` is arbitrary text rather than a serialized tool
    // result. Its call association is still statically known, while its exit
    // status remains unknown (decode warnings are retained below).
    const canMap = plan.reliable && (propertyOnlyEmission || (!decodeWarnings.length && emitted.length === plan.slots.length && matched.length === 1));
    const localWarnings = [...plan.warnings, ...decodeWarnings];
    if (!canMap) localWarnings.push('No reliable one-to-one ordered mapping for emitted slots');
    if (!plan.slots.filter(Boolean).length) operations.push({ id: `${id}/opaque`, name: p.name,
      status: 'unknown', confidence: 'Uncertain', reason: 'Unsupported exec shape; inspect original evidence',
      evidence: [pointer(call.line), ...resultLines.map(l => pointer(l))] });
    plan.slots.forEach((slot, i) => {
      if (!slot) return;
      const state = canMap ? operationOutcome(emitted[i], slot.name)
        : { status: 'unknown', confidence: 'Uncertain', reason: 'Missing, partial, ambiguous or unmappable output' };
      const operation = { id: `${id}/op${i + 1}`, parentCallId: id, name: slot.name,
        args: slot.args, ...state, mapping: canMap ? (slot.emittedProperty ? `static local-variable ${slot.emittedProperty} emission` : 'static ordered emission') : 'unresolved',
        evidence: [pointer(call.line, { codeRange: slot.codeRange }), ...resultLines.map(l => pointer(l, { outputSlot: canMap ? i : null }))],
        warnings: [...localWarnings, ...(slot.unresolved ? [slot.unresolved] : [])] };
      if (['exec_command', 'shell_command', 'shell'].includes(slot.name)) {
        operation.command = slot.args?.cmd ?? slot.args?.command;
        if (Array.isArray(operation.command)) operation.command = operation.command.join(' ');
        if (typeof operation.command === 'string') {
          operation.kinds = commandKinds(operation.command);
          operation.cwd = slot.args?.workdir ?? slot.args?.cwd ?? session?.cwd;
          nodes.push({ id: `${operation.id}/shell`, kind: 'Shell command', confidence: 'Confirmed',
            scope: 'Literal call intent, execution outcome tracked separately', operationId: operation.id, evidence: operation.evidence });
          if (operation.kinds.possibleWrite) nodes.push({ id: `${operation.id}/possible-write`, kind: 'File edit/write', confidence: 'Uncertain',
            scope: 'Shell text suggests writes; individual writes and their outcomes are not parsed/proven',
            operationId: operation.id, evidence: operation.evidence });
          if (operation.kinds.test) nodes.push({ id: `${operation.id}/test`, kind: 'Test execution', confidence: operation.confidence,
            operationId: operation.id, status: operation.status, evidence: operation.evidence });
        }
      }
      if (slot.name === 'apply_patch' && typeof slot.args === 'string') operation.edits = patchEdits(slot.args);
      if (['edit_file', 'write_file'].includes(slot.name) && typeof slot.args === 'object') operation.edits = [{
        action: slot.name === 'write_file' ? 'write' : 'edit', path: slot.args.path ?? slot.args.file_path,
        added: typeof slot.args.content === 'string' ? slot.args.content.split('\n') : [], removed: [], context: [],
      }].filter(e => e.path);
      for (const [j, edit] of (operation.edits || []).entries()) nodes.push({ id: `${operation.id}/edit${j + 1}`,
        kind: 'File edit/write', confidence: operation.confidence, status: operation.status,
        path: edit.path, operationId: operation.id, evidence: operation.evidence });
      operations.push(operation);
    });
    warnings.push(...localWarnings.map(message => ({ callId: id, message })));
  }
  // PTY handle joins later write_stdin completions; initial yield is not success.
  for (const op of operations.filter(o => o.status === 'running' && o.name === 'exec_command')) {
    const polls = operations.filter(o => o.name === 'write_stdin' && o.args?.session_id === op.value.session_id
      && o.evidence[0].line > op.evidence[0].line);
    const end = polls.find(p => ['succeeded', 'failed'].includes(p.status));
    if (end) { op.initialOutcome = { status: op.status, value: op.value }; op.status = end.status;
      op.confidence = end.confidence; op.value = end.value; op.reason = `PTY completion via ${end.id}: ${end.reason}`;
      op.completionOperationId = end.id; op.evidence.push(...end.evidence); }
  }
  for (const op of operations.filter(o => o.kinds?.test)) nodes.push({ id: `${op.id}/test-result`, kind: 'Test result',
    confidence: op.confidence, status: op.status, operationId: op.id,
    scope: 'Process exit result, not proof of any named assertion unless reported', evidence: op.evidence });
  for (const node of nodes.filter(n => n.kind === 'Test execution')) {
    const op = operations.find(o => o.id === node.operationId);
    node.status = op.status; node.confidence = op.confidence; node.evidence = op.evidence;
  }
  return { schemaVersion: 'margin.evidence.v1', source: capture, nodes, operations, warnings,
    coverage: { rawRecords: records.length, toolCalls: calls.length, toolResults: results.length,
      matchedCalls: nodes.filter(n => n.kind === 'Tool call' && n.resultIds.length).length } };
}
