import { parseSessionEntries, migrateSessionEntries, buildContextEntries } from '@earendil-works/pi-coding-agent';
import { commandKinds } from '../../core/handoff/exec.js';
import { normalizeUserRequirement } from '../../core/handoff/session-source.js';

// Pi-native evidence extractor → margin.evidence.v1.
//
// This lives in the Pi adapter layer (not under src/core) because the Shared Handoff Core must
// stay Pi-independent. Reuse boundary: entry typing, active-branch selection and compaction
// semantics come from the Pi SDK (parseSessionEntries + buildContextEntries), NOT a hand-written
// Pi tree/parser. This extractor only maps the SDK's active, compaction-aware entry stream into
// the agent-neutral evidence shape the Shared Handoff Core already consumes.
//
// This extractor provides native facts only. It never generates Goal / Progress / Pending /
// Validation / Follow-up — those stay with the existing Shared Core (distiller/repo-truth).

// Shell-equivalent Pi tools whose literal command line carries execution semantics (test/exit).
const SHELL_TOOLS = new Set(['powershell', 'bash', 'git']);
// Edit/write tools → structured repo targets for repo-truth reconciliation.
const EDIT_TOOLS = new Set(['edit', 'write']);
// Non-semantic tools: not a user requirement, Progress, Pending, or repo target.
const INTERNAL_TOOLS = new Set(['todo', 'subagent']);

function textFromContent(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content.filter(c => typeof c?.text === 'string').map(c => c.text).filter(Boolean).join('\n');
}
function toolCallBlocks(content) {
  return Array.isArray(content) ? content.filter(c => c?.type === 'toolCall') : [];
}

export function buildPiEvidence(source) {
  const { records, capture, session } = source ?? {};
  if (!records || !capture?.sha256) throw Error('Session source required: { records, capture, session }');
  const content = typeof source.content === 'string' && source.content
    ? source.content
    : records.map(({ event }) => JSON.stringify(event)).join('\n');

  // Native semantics from the Pi SDK. Only the current active branch reaches evidence; abandoned
  // sibling branches and pre-compaction folded history are excluded by buildContextEntries.
  let entries;
  try { entries = parseSessionEntries(content); } catch { entries = records.map(({ event }) => event); }
  try { migrateSessionEntries(entries); } catch { /* already current format; mutation is in place */ }
  const active = buildContextEntries(entries);
  const activeIds = new Set(active.map(e => String(e.id ?? '')));

  const nodes = [], operations = [], warnings = [];
  const pointer = (line, extra = {}) => ({ path: capture.snapshotPath, sha256: capture.sha256, line, ...extra });
  const lineByEntryId = new Map();
  for (const { line, event } of records) if (event?.id) lineByEntryId.set(String(event.id), line);

  // Active-branch toolResult index by toolCallId. A result on a discarded branch is not an active outcome.
  const resultsByCallId = new Map();
  const resultLineByCallId = new Map();
  for (const { line, event } of records) {
    if (event?.type !== 'message' || event?.message?.role !== 'toolResult') continue;
    if (!activeIds.has(String(event.id ?? ''))) continue;
    const id = String(event.message.toolCallId ?? '');
    if (!id) continue;
    resultsByCallId.set(id, event.message);
    resultLineByCallId.set(id, line);
  }

  for (const entry of active) {
    const line = lineByEntryId.get(String(entry.id ?? '')) ?? null;
    if (entry.type !== 'message') {
      // Compaction / branch summary are provenance, never user requirements or progress.
      if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        nodes.push({ id: `ctx:${entry.id}`, kind: 'Internal context/control', confidence: 'Confirmed',
          scope: entry.type === 'compaction'
            ? `Pi compaction; summarized ${Number.isFinite(entry.tokensBefore) ? entry.tokensBefore : 'known'} tokens. Folded pre-compaction history is represented once by this summary, not re-enumerated.`
            : 'Pi branch summary; abandoned-branch provenance retained, not current progress.',
          text: typeof entry.summary === 'string' ? entry.summary : undefined,
          evidence: [pointer(line)] });
      }
      // model_change / thinking_level_change / label / session_info / custom are non-semantic.
      continue;
    }
    const m = entry.message;
    if (m.role === 'user') {
      const requirement = normalizeUserRequirement(textFromContent(m.content));
      if (requirement) nodes.push({ id: `requirement:${entry.id}`, kind: 'User requirement', confidence: 'Confirmed',
        scope: 'The request was made, not that it was completed', text: requirement, evidence: [pointer(line)] });
    } else if (m.role === 'assistant') {
      const text = textFromContent(m.content);
      if (text) nodes.push({ id: `claim:${entry.id}`, kind: 'Assistant claim', confidence: 'Inferred',
        scope: 'Unverified narrative; not completion evidence', text, evidence: [pointer(line)] });
    }
    // toolResult handled via the per-call association below, in transcript order.
  }

  const toolCalls = [];
  for (const entry of active) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
    const line = lineByEntryId.get(String(entry.id ?? '')) ?? null;
    for (const call of toolCallBlocks(entry.message.content)) {
      toolCalls.push({ id: String(call.id), entry, line, call });
    }
  }

  for (const { id: callId, entry, line, call } of toolCalls) {
    const resultMsg = resultsByCallId.get(callId);
    const resultLine = resultLineByCallId.get(callId) ?? null;
    const nodeId = `call:${callId}`;
    const opId = `${call.name}:${callId}`;
    nodes.push({ id: nodeId, kind: 'Tool call', confidence: 'Confirmed', name: call.name, callId,
      ...(entry.timestamp ? { at: entry.timestamp } : {}),
      evidence: [pointer(line)],
      resultIds: resultMsg ? [`result:${callId}`] : [] });
    if (resultMsg) {
      nodes.push({ id: `result:${callId}`, kind: 'Tool result', confidence: 'Confirmed', callId,
        ...(resultMsg.timestamp ? { at: resultMsg.timestamp } : {}),
        evidence: [pointer(resultLine)],
        scope: resultMsg.isError ? 'Tool reported failure; outcome is failed'
          : resultMsg.details?.truncation?.truncated ? 'Output observed (truncated in native record); success judged by isError'
          : 'Tool reported success' });
    }

    const status = resultMsg ? (resultMsg.isError ? 'failed' : 'succeeded') : 'unknown';
    const confidence = resultMsg ? 'Confirmed' : 'Uncertain';
    const reason = resultMsg
      ? (resultMsg.isError ? 'Explicit isError in toolResult' : `Tool result observed (${resultMsg.details?.truncation?.truncated ? 'truncated by native record' : 'complete'})`)
      : 'incomplete/unmatched toolCall — no toolResult in capture; no success inferred';
    const opEvidence = [pointer(line), ...(resultMsg ? [pointer(resultLine)] : [])];
    const args = (call.arguments && typeof call.arguments === 'object') ? call.arguments : {};

    if (SHELL_TOOLS.has(call.name) && typeof args.command === 'string' && args.command.trim()) {
      const kinds = commandKinds(args.command);
      const operation = { id: opId, name: call.name, command: args.command, args,
        cwd: session?.cwd ?? null, status, confidence, reason, mapping: 'Pi shell tool call',
        kinds, evidence: opEvidence, warnings: [] };
      nodes.push({ id: `${opId}/shell`, kind: 'Shell command', confidence: 'Confirmed',
        scope: 'Literal call intent; execution outcome tracked separately', operationId: opId, evidence: operation.evidence });
      if (kinds.test) nodes.push({ id: `${opId}/test`, kind: 'Test execution', confidence: operation.confidence,
        operationId: opId, status: operation.status, evidence: operation.evidence });
      operations.push(operation);
    } else if (EDIT_TOOLS.has(call.name)) {
      let edits = [];
      if (call.name === 'edit' && typeof args.path === 'string') {
        edits = (Array.isArray(args.edits) ? args.edits : []).map(e => ({
          action: 'edit', path: args.path,
          added: String(e?.newText ?? '').split('\n'), removed: String(e?.oldText ?? '').split('\n'), context: [],
        })).filter(e => e.path);
      } else if (call.name === 'write' && typeof args.path === 'string') {
        edits = [{ action: 'write', path: args.path, added: String(args.content ?? '').split('\n'), removed: [], context: [] }];
      }
      if (edits.length) {
        const operation = { id: opId, name: call.name, args, status, confidence, reason,
          mapping: `Pi ${call.name} tool call`, edits, evidence: opEvidence, warnings: [] };
        for (const [i, edit] of edits.entries()) nodes.push({ id: `${opId}/edit${i + 1}`, kind: 'File edit/write',
          confidence: operation.confidence, status: operation.status, path: edit.path,
          operationId: opId, evidence: operation.evidence });
        operations.push(operation);
      }
      // edit/write with no resolvable path contributes no structured repo target; the Tool call
      // node above still records association and outcome for provenance.
    } else {
      // Read-only (read/ls/grep/find) and internal (todo/subagent) tools: no operation that
      // feeds Progress/Validation/structured-work, but association and outcome are preserved.
      void opId;
    }
    if (!resultMsg && !INTERNAL_TOOLS.has(call.name)) {
      warnings.push({ callId: nodeId, message: `incomplete/unmatched toolCall '${call.name}' — no toolResult in capture; outcome unknown` });
    }
  }

  for (const op of operations.filter(o => o.kinds?.test)) nodes.push({ id: `${op.id}/test-result`, kind: 'Test result',
    confidence: op.confidence, status: op.status, operationId: op.id,
    scope: 'Process exit result, not proof of any named assertion unless reported', evidence: op.evidence });
  for (const node of nodes.filter(n => n.kind === 'Test execution')) {
    const op = operations.find(o => o.id === node.operationId);
    node.status = op.status; node.confidence = op.confidence; node.evidence = op.evidence;
  }

  return { schemaVersion: 'margin.evidence.v1', source: capture, nodes, operations, warnings,
    coverage: { rawRecords: records.length, activeBranchRecords: active.length,
      toolCalls: toolCalls.length, toolResults: resultsByCallId.size,
      matchedCalls: toolCalls.filter(c => resultsByCallId.has(c.id)).length,
      activeLeafId: active.length ? String(active[active.length - 1].id) : null } };
}