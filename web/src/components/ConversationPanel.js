import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

const MAX_MESSAGE_LENGTH = 2_000;
const SAFE_ERROR_CODES = new Set([
  'invalid_request', 'permission_denied', 'not_found', 'version_conflict', 'invalid_transition',
  'runtime_unavailable', 'storage_failure', 'transport_unavailable', 'workstream_not_found',
  'run_not_found', 'cross_workstream_reference', 'run_not_running'
]);

function safeError(result) {
  const error = result?.error;
  return SAFE_ERROR_CODES.has(error?.code)
    ? { code: error.code, retryable: error.retryable === true }
    : { code: 'storage_failure', retryable: true };
}

function activeRun(items) {
  return (Array.isArray(items) ? items : []).find((item) => item?.status === 'running' && typeof item.id === 'string' && item.id.trim()) ?? null;
}

function bounded(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : null;
}

function evidence(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    ...(bounded(item.toolName, 100) ? { toolName: item.toolName } : {}),
    ...(bounded(item.code, 100) ? { code: item.code } : {}),
    ...(bounded(item.auditId, 200) ? { auditId: item.auditId } : {}),
    ...(bounded(item.entityId, 200) ? { entityId: item.entityId } : {}),
    ...(Number.isInteger(item.entityVersion) && item.entityVersion >= 0 ? { entityVersion: item.entityVersion } : {})
  };
}

function assistantMessage(result) {
  const text = bounded(result?.data?.message, MAX_MESSAGE_LENGTH);
  return text ? { role: 'assistant', text, evidence: (Array.isArray(result?.data?.toolResults) ? result.data.toolResults : []).slice(0, 20).map(evidence) } : null;
}

export function ConversationPanel({ api, workstreamId, refreshToken = 0, onAuthoritativeRefresh }) {
  const [state, setState] = useState({ loading: false, submitting: false, error: null, run: null, message: '', messages: [] });
  const mounted = useRef(false);
  const request = useRef(0);
  const submitSequence = useRef(0);
  const submitting = useRef(false);
  const selection = useRef({ id: workstreamId, generation: 0 });
  if (selection.current.id !== workstreamId) {
    selection.current = { id: workstreamId, generation: selection.current.generation + 1 };
    submitting.current = false;
    ++request.current;
  }
  const isCurrent = (id, generation) => mounted.current && selection.current.id === id && selection.current.generation === generation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++request.current; };
  }, []);

  const loadRun = useCallback(async () => {
    const id = workstreamId;
    const generation = selection.current.generation;
    if (!id || !isCurrent(id, generation)) return false;
    const token = ++request.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    let result;
    try {
      result = await api.query('run.list', { workstreamId: id, statuses: ['running'], limit: 100 });
    } catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!isCurrent(id, generation) || token !== request.current) return false;
    if (result?.ok !== true) {
      setState((current) => ({ ...current, loading: false, run: null, error: safeError(result) }));
      return false;
    }
    setState((current) => ({ ...current, loading: false, run: activeRun(result.data?.items), error: null }));
    return true;
  }, [api, workstreamId]);

  useEffect(() => {
    setState((current) => ({ ...current, loading: Boolean(workstreamId), submitting: false, error: null, run: null, message: '', messages: [] }));
    if (workstreamId) void loadRun();
  }, [loadRun, workstreamId]);

  useEffect(() => { if (workstreamId) void loadRun(); }, [loadRun, refreshToken, workstreamId]);

  const submit = useCallback(async () => {
    const id = workstreamId;
    const generation = selection.current.generation;
    const run = state.run;
    const message = state.message.trim();
    if (!isCurrent(id, generation) || state.submitting || submitting.current || !run || !message || message.length > MAX_MESSAGE_LENGTH) return;
    submitting.current = true;
    const requestId = `web_interaction_${Date.now().toString(36)}_${++submitSequence.current}`;
    setState((current) => ({ ...current, submitting: true, error: null, message: '', messages: [...current.messages, { role: 'user', text: message, evidence: [] }] }));
    let result;
    try { result = await api.interact({ workstreamId: id, runId: run.id, message, requestId }); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (isCurrent(id, generation)) {
      const answer = result?.ok === true ? assistantMessage(result) : null;
      setState((current) => ({ ...current, error: result?.ok === true ? null : safeError(result), ...(answer ? { messages: [...current.messages, answer] } : {}) }));
    }
    try { await onAuthoritativeRefresh?.(id, () => isCurrent(id, generation)); }
    finally {
      if (isCurrent(id, generation)) {
        await loadRun();
        if (isCurrent(id, generation)) {
          submitting.current = false;
          setState((current) => ({ ...current, submitting: false }));
        }
      }
    }
  }, [api, loadRun, onAuthoritativeRefresh, state.message, state.run, state.submitting, workstreamId]);

  const enabled = Boolean(workstreamId && state.run && !state.loading && !state.submitting);
  return createElement('section', { className: 'conversation-panel', 'data-conversation-panel': 'true' },
    createElement('h2', null, 'Conversation'),
    state.error ? createElement('p', { role: 'alert' }, errorLabel(state.error)) : null,
    !workstreamId ? createElement('p', { className: 'muted' }, 'Select a workstream to start a conversation.') : null,
    workstreamId && !state.loading && !state.run ? createElement('p', { className: 'muted' }, 'Start a Run to continue.') : null,
    createElement('ul', { className: 'conversation-messages' }, state.messages.map((item, index) => createElement('li', { key: `${index}:${item.role}`, 'data-conversation-message': item.role },
      createElement('strong', null, item.role === 'user' ? 'You' : 'Assistant'),
      createElement('p', null, item.text),
      item.evidence.length ? createElement('ul', { className: 'conversation-evidence' }, item.evidence.map((tool, toolIndex) => createElement('li', { key: toolIndex }, Object.entries(tool).map(([key, value]) => `${key}: ${value}`).join(' · ')))) : null
    ))),
    createElement('label', null, 'Message', createElement('textarea', {
      value: state.message, maxLength: MAX_MESSAGE_LENGTH, disabled: !enabled, 'data-conversation-input': 'true',
      onInput: (event) => setState((current) => ({ ...current, message: event.target.value.slice(0, MAX_MESSAGE_LENGTH) }))
    })),
    createElement('button', { type: 'button', disabled: !enabled || !state.message.trim(), 'data-conversation-submit': 'true', onClick: submit }, state.submitting ? 'Sending…' : 'Send')
  );
}
