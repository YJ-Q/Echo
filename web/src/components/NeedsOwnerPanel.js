import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

function failure(result) { return result?.error ?? { code: 'transport_unavailable', retryable: true }; }

function validCursor(value, seen) {
  return typeof value === 'string' && value.trim() && !seen.has(value) ? value : null;
}

export function NeedsOwnerPanel({ api, workstreamId, onAuthoritativeReload, onActivityReload }) {
  const [state, setState] = useState({ loading: false, submitting: false, error: null, items: [], answers: {} });
  const mounted = useRef(false);
  const request = useRef(0);
  const requestSequence = useRef(0);
  const intentSequence = useRef(0);
  const intents = useRef(new Map());
  const selection = useRef({ id: workstreamId, generation: 0 });
  if (selection.current.id !== workstreamId) {
    selection.current = { id: workstreamId, generation: selection.current.generation + 1 };
    ++request.current;
  }

  const isCurrent = (id, generation) => mounted.current && selection.current.id === id && selection.current.generation === generation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++request.current; };
  }, []);

  const load = useCallback(async () => {
    const id = workstreamId;
    const generation = selection.current.generation;
    if (!id || !isCurrent(id, generation)) return false;
    const loadRequest = ++request.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    const items = [];
    const seen = new Set();
    let cursor = null;
    let result;
    do {
      try {
        result = await api.query('needs_owner.list', {
          workstreamId: id, statuses: ['open'], limit: 100, ...(cursor ? { cursor } : {})
        });
      } catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
      if (!isCurrent(id, generation) || loadRequest !== request.current) return false;
      if (result?.ok !== true) {
        setState((current) => ({ ...current, loading: false, error: failure(result) }));
        return false;
      }
      items.push(...(Array.isArray(result.data?.items) ? result.data.items : []));
      cursor = validCursor(result.data?.nextCursor, seen);
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (!isCurrent(id, generation) || loadRequest !== request.current) return false;
    setState((current) => ({ ...current, loading: false, error: null, items, answers: {} }));
    return true;
  }, [api, workstreamId]);

  useEffect(() => {
    intents.current = new Map();
    setState({ loading: Boolean(workstreamId), submitting: false, error: null, items: [], answers: {} });
    if (workstreamId) void load();
  }, [load, workstreamId]);

  const setAnswer = useCallback((id, value) => {
    setState((current) => ({ ...current, answers: { ...current.answers, [id]: value } }));
  }, []);

  const resolve = useCallback(async (item) => {
    const id = workstreamId;
    const generation = selection.current.generation;
    if (!isCurrent(id, generation) || state.submitting || !item || item.workstreamId !== id) return;
    const selected = state.answers[item.id] ?? '';
    const hasOptions = Array.isArray(item.options) && item.options.length > 0;
    if ((hasOptions && !item.options.some((option) => option?.id === selected)) || (!hasOptions && !selected.trim())) return;
    const identity = `${item.id}:${item.version}`;
    if (!intents.current.has(identity)) {
      intents.current.set(identity, `web_needs_owner_resolve_intent_${Date.now().toString(36)}_${++intentSequence.current}`);
    }
    const payload = hasOptions ? { needsOwnerId: item.id, optionId: selected } : { needsOwnerId: item.id, resolutionSummary: selected.trim() };
    const options = {
      requestId: `web_needs_owner_resolve_${Date.now().toString(36)}_${++requestSequence.current}`,
      idempotencyKey: intents.current.get(identity), expectedVersion: item.version
    };
    setState((current) => ({ ...current, submitting: true, error: null }));
    let result;
    try { result = await api.command('needs_owner.resolve', payload, options); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!isCurrent(id, generation)) return;
    await Promise.all([
      load(),
      onAuthoritativeReload?.(id, () => isCurrent(id, generation))
    ]);
    if (!isCurrent(id, generation)) return;
    onActivityReload?.();
    setState((current) => ({ ...current, submitting: false, error: result?.ok === true ? null : failure(result) }));
  }, [api, load, onActivityReload, onAuthoritativeReload, state.answers, state.submitting, workstreamId]);

  if (!workstreamId) return null;
  return createElement('section', { className: 'needs-owner-panel', 'data-needs-owner-panel': 'true' },
    createElement('h2', null, 'Needs owner'),
    state.error ? createElement('p', { role: 'alert' }, errorLabel(state.error)) : null,
    state.loading && !state.items.length ? createElement('p', { className: 'muted' }, 'Loading owner requests…') : null,
    !state.loading && !state.items.length ? createElement('p', { className: 'muted' }, 'No owner requests.') : null,
    createElement('ul', null, state.items.map((item) => createElement('li', { key: item.id, className: 'needs-owner-item' },
      createElement('strong', null, item.reason),
      detail('Consequence', item.consequenceSummary), detail('Context', item.contextSummary),
      Array.isArray(item.options) && item.options.length
        ? createElement('label', null, 'Resolution', createElement('select', {
          value: state.answers[item.id] ?? '', 'data-needs-owner-option': item.id,
          disabled: state.submitting, onChange: (event) => setAnswer(item.id, event.target.value)
        }, createElement('option', { value: '' }, 'Select an option'), item.options.map((option) => createElement('option', { key: option.id, value: option.id }, option.label))))
        : createElement('label', null, 'Response', createElement('textarea', {
          value: state.answers[item.id] ?? '', 'data-needs-owner-summary': item.id, maxLength: 2000,
          disabled: state.submitting, onInput: (event) => setAnswer(item.id, event.target.value)
        })),
      Array.isArray(item.options) && item.options.length ? createElement('ul', { className: 'needs-owner-options' }, item.options.map((option) =>
        option.consequenceSummary ? createElement('li', { key: option.id }, `${option.label}: ${option.consequenceSummary}`) : null
      )) : null,
      createElement('button', {
        type: 'button', 'data-needs-owner-resolve': item.id, disabled: state.submitting,
        onClick: () => resolve(item)
      }, state.submitting ? 'Resolving…' : 'Resolve')
    )))
  );
}

function detail(label, value) {
  return typeof value === 'string' && value.trim()
    ? createElement('p', { key: label }, createElement('strong', null, `${label}: `), value)
    : null;
}
