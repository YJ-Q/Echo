import { commandKinds } from '../../core/handoff/exec.js';
import { normalizeUserRequirement } from '../../core/handoff/session-source.js';

// Claude-native evidence extractor → margin.evidence.v1.
//
// This lives in the Claude adapter layer (not under src/core) because the Shared Handoff Core
// must stay agent-independent. It maps only the verified Claude Code 2.1.258 native schema
// (user / assistant / system records; assistant.content = text|thinking|tool_use;
// user.content = text|tool_result) into the agent-neutral evidence shape the Shared Core
// already consumes. It never guesses recursive nested fields.
//
// This extractor provides native facts only. It never generates Goal / Progress / Pending /
// Validation / Follow-up — those stay with the existing Shared Core (distiller/repo-truth).

// Shell-equivalent Claude tools whose literal command line carries execution semantics (test/exit).
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// Edit/write tools → structured repo targets for repo-truth reconciliation.
const EDIT_TOOLS = new Set(['Edit', 'Write']);
// Internal tools: Agent spawns a subagent (its transcript lives in a separate file), TodoWrite /
// Skill / Monitor / TaskOutput / TaskStop / SendMessage are agent bookkeeping, not user-level
// requirement / Progress / Pending / repo targets.
const INTERNAL_TOOLS = new Set(['Agent', 'TodoWrite', 'Skill', 'Monitor', 'TaskOutput', 'TaskStop', 'SendMessage']);

// Non-conversation top-level record types excluded from main evidence.
const BOOKKEEP_TYPES = new Set([
  'queue-operation', 'atis-latch', 'ai-title', 'custom-title', 'attachment',
  'file-history-snapshot', 'file-history-delta', 'last-prompt', 'mode',
]);

const COMPACT_SUMMARY_PREFIX = /^This session is being continued from a previous conversation that ran out of context\./i;
const TASK_NOTIFICATION = /^\s*<task-notification>/;
// Claude injects user-role control messages that are not human task phrasing: slash-command
// envelopes, local-command caveat/stdout wrappers, and interrupt markers. They must never
// become Goal candidates.
const INJECTED_CONTROL = /^(?:<local-command[^>]*>\s*|\[request interrupted by user\]\s*)/i;
const SLASH_COMMAND_ENVELOPE = /<command-name>\/[a-z][a-z0-9-]*<\/command-name>/i;

function isInjectedControl(text) {
  const t = String(text || '').trim();
  return INJECTED_CONTROL.test(t) || SLASH_COMMAND_ENVELOPE.test(t);
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
}

const isCompactSummary = text => COMPACT_SUMMARY_PREFIX.test(String(text || '').trimStart());
const isTaskNotification = text => TASK_NOTIFICATION.test(String(text || ''));

export function buildClaudeEvidence(source) {
  const { records, capture, session } = source ?? {};
  if (!records || !capture?.sha256) throw Error('Session source required: { records, capture, session }');
  const pointer = (line, extra = {}) => ({ path: capture.snapshotPath, sha256: capture.sha256, line, ...extra });

  // ── Compaction: system subtype="compact_boundary" is followed immediately by a user message
  // whose content is the continuation summary. That summary is the only representation of the
  // folded pre-compaction history; it is never re-enumerated and never treated as a new Goal.
  const compactBoundary = new Map(); // boundaryLine -> { summaryLine, summaryText }
  for (let i = 0; i < records.length; i += 1) {
    const ev = records[i].event;
    if (ev?.type !== 'system' || ev?.subtype !== 'compact_boundary') continue;
    for (let j = i + 1; j < records.length; j += 1) {
      const next = records[j].event;
      if (next?.type === 'user' && next?.isSidechain !== true) {
        const text = textFromContent(next.message?.content);
        if (isCompactSummary(text)) compactBoundary.set(records[i].line, { summaryLine: records[j].line, summaryText: text });
        break;
      }
      if (next?.type === 'assistant') break;
    }
  }
  const compactionSummaryLines = new Set([...compactBoundary.values()].map(v => v.summaryLine));
  // Everything up to (and including) the most recent continuation summary is folded history
  // represented once by that summary; it is never re-enumerated as separate foreground records.
  let foldedUntilLine = 0;
  for (const { summaryLine } of compactBoundary.values()) foldedUntilLine = Math.max(foldedUntilLine, summaryLine);

  // ── Tool result index by tool_use_id (only foreground user records). Association is by the
  // native id: assistant.tool_use.id ↔ user.tool_result.tool_use_id.
  const resultsByCallId = new Map();
  const resultLineByCallId = new Map();
  for (const { line, event } of records) {
    if (event?.type !== 'user' || event?.isSidechain === true || event?.agentId) continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      const id = block.tool_use_id;
      if (id === undefined || id === null) continue;
      resultsByCallId.set(String(id), block);
      resultLineByCallId.set(String(id), line);
    }
  }

  const nodes = [], operations = [], warnings = [];

  // ── Foreground user / assistant / compaction evidence, in physical record order.
  for (const { line, event } of records) {
    if (event?.type === 'system') {
      // api_error and other internal system records are not user evidence.
      if (event.subtype === 'compact_boundary') {
        const info = compactBoundary.get(line);
        nodes.push({ id: `ctx:L${line}`, kind: 'Internal context/control', confidence: 'Confirmed',
          scope: 'Claude compaction boundary; folded pre-compaction history is represented once by the continuation summary, not re-enumerated.',
          ...(info?.summaryText ? { text: info.summaryText } : {}), evidence: [pointer(line)] });
      }
      continue;
    }
    if (BOOKKEEP_TYPES.has(event?.type)) continue;
    if (event?.isSidechain === true || event?.agentId) continue; // subagent / internal sidechain

    if (event.type === 'user' || event.type === 'assistant') {
      if (line <= foldedUntilLine) continue; // folded into a continuation summary; not re-enumerated
    }

    if (event.type === 'user') {
      if (compactionSummaryLines.has(line)) continue; // represented once by the compaction node above
      const text = textFromContent(event.message?.content);
      if (!text || isTaskNotification(text) || isInjectedControl(text)) continue; // subagent transcript / control envelope is not foreground
      const requirement = normalizeUserRequirement(text);
      if (requirement) nodes.push({ id: `requirement:L${line}`, kind: 'User requirement', confidence: 'Confirmed',
        scope: 'The request was made, not that it was completed', text: requirement, evidence: [pointer(line)] });
    } else if (event.type === 'assistant') {
      const text = textFromContent(event.message?.content);
      if (text) nodes.push({ id: `claim:L${line}`, kind: 'Assistant claim', confidence: 'Inferred',
        scope: 'Unverified narrative; not completion evidence', text, evidence: [pointer(line)] });
    }
  }

  // ── tool_use calls (assistant records), in transcript order.
  const toolCalls = [];
  for (const { line, event } of records) {
    if (event?.type !== 'assistant' || event?.isSidechain === true || event?.agentId) continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const call of content) {
      if (call?.type !== 'tool_use' || !call.id) continue;
      toolCalls.push({ id: String(call.id), line, call, at: event.timestamp });
    }
  }

  for (const { id: callId, line, call, at } of toolCalls) {
    const resultMsg = resultsByCallId.get(callId);
    const resultLine = resultLineByCallId.get(callId) ?? null;
    const nodeId = `call:${callId}`;
    const opId = `${call.name}:${callId}`;
    nodes.push({ id: nodeId, kind: 'Tool call', confidence: 'Confirmed', name: call.name, callId,
      ...(at ? { at } : {}), evidence: [pointer(line)],
      resultIds: resultMsg ? [`result:${callId}`] : [] });
    if (resultMsg) {
      nodes.push({ id: `result:${callId}`, kind: 'Tool result', confidence: 'Confirmed', callId,
        evidence: [pointer(resultLine)],
        scope: resultMsg.is_error === true ? 'Tool reported failure; outcome is failed'
          : resultMsg.is_error === false || resultMsg.is_error === undefined ? 'Tool reported success; is_error not set'
          : 'Tool result observed' });
    }

    // tool_result is the primary outcome truth. is_error === true → failed; matched &
    // is_error !== true → succeeded; unmatched/in-flight → unknown (never success).
    const status = resultMsg ? (resultMsg.is_error === true ? 'failed' : 'succeeded') : 'unknown';
    const confidence = resultMsg ? 'Confirmed' : 'Uncertain';
    const reason = resultMsg
      ? (resultMsg.is_error === true ? 'Explicit is_error in tool_result' : 'Tool result observed')
      : 'incomplete/unmatched toolCall — no tool_result in capture; no success inferred';
    const opEvidence = [pointer(line), ...(resultMsg ? [pointer(resultLine)] : [])];
    const input = (call.input && typeof call.input === 'object') ? call.input : {};

    // Structured operations that the Shared Core / repo-truth can reconcile.
    if (SHELL_TOOLS.has(call.name) && typeof input.command === 'string' && input.command.trim()) {
      const kinds = commandKinds(input.command);
      const operation = { id: opId, name: call.name, command: input.command, args: input,
        cwd: session?.cwd ?? null, status, confidence, reason, mapping: 'Claude shell tool call',
        kinds, evidence: opEvidence, warnings: [] };
      nodes.push({ id: `${opId}/shell`, kind: 'Shell command', confidence: 'Confirmed',
        scope: 'Literal call intent; execution outcome tracked separately', operationId: opId, evidence: operation.evidence });
      if (kinds.test) nodes.push({ id: `${opId}/test`, kind: 'Test execution', confidence: operation.confidence,
        operationId: opId, status: operation.status, evidence: operation.evidence });
      operations.push(operation);
    } else if (EDIT_TOOLS.has(call.name)) {
      let edits = [];
      const filePath = typeof input.file_path === 'string' ? input.file_path : null;
      if (call.name === 'Edit' && filePath) {
        edits = [{ action: 'edit', path: filePath, added: String(input.new_string ?? '').split('\n'),
          removed: String(input.old_string ?? '').split('\n'), context: [] }].filter(e => e.path);
      } else if (call.name === 'Write' && filePath) {
        edits = [{ action: 'write', path: filePath, added: String(input.content ?? '').split('\n'),
          removed: [], context: [] }].filter(e => e.path);
      }
      if (edits.length) {
        const operation = { id: opId, name: call.name, args: input, status, confidence, reason,
          mapping: `Claude ${call.name} tool call`, edits, evidence: opEvidence, warnings: [] };
        for (const [i, edit] of edits.entries()) nodes.push({ id: `${opId}/edit${i + 1}`, kind: 'File edit/write',
          confidence: operation.confidence, status: operation.status, path: edit.path,
          operationId: opId, evidence: operation.evidence });
        operations.push(operation);
      }
      // Edit/Write with no resolvable path contributes no structured repo target; the Tool call
      // node above still records association and outcome for provenance.
      // toolUseResult on the user record is only side evidence and never overrides tool_result.
    } else {
      // Read-only (Read/Grep/Glob/WebSearch/WebFetch/Artifact/AskUserQuestion) and internal
      // (Agent/TodoWrite/Skill/...) tools: association and outcome are preserved as Tool
      // call/result nodes, but no shell/edit operation is manufactured.
    }

    if (!resultMsg && !INTERNAL_TOOLS.has(call.name)) {
      warnings.push({ callId: nodeId, message: `incomplete/unmatched toolCall '${call.name}' — no tool_result in capture; outcome unknown` });
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
    coverage: { rawRecords: records.length,
      toolCalls: toolCalls.length, toolResults: resultsByCallId.size,
      matchedCalls: toolCalls.filter(c => resultsByCallId.has(c.id)).length,
      compactionBoundaries: compactBoundary.size } };
}
