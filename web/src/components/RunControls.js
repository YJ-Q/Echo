import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const OPEN_STATUSES = Object.freeze(['queued', 'running', 'paused', 'needs_owner']);
const ACTIONS = Object.freeze({
  queued: ['start', 'stop'], running: ['pause', 'stop'], paused: ['resume', 'stop'], needs_owner: ['resume', 'stop']
});

function currentRun(items) {
  return items.find((item) => item && !TERMINAL.has(item.status)) ?? items[0] ?? null;
}

function actionLabel(action) { return action[0].toUpperCase() + action.slice(1); }

export function RunControls({ api, workstreamId, onAuthoritativeReload }) {
  const [state, setState] = useState({ loading: false, submitting: false, error: null, run: null });
  const mounted = useRef(false);
  const request = useRef(0);
  const selection = useRef({ id: workstreamId, generation: 0 });
  const requestSequence = useRef(0);
  const intentSequence = useRef(0);
  const intents = useRef(new Map());
  if (selection.current.id !== workstreamId) {
    selection.current = { id: workstreamId, generation: selection.current.generation + 1 };
    ++request.current;
  }

  const isCurrentSelection = (id, generation) => mounted.current &&
    selection.current.id === id && selection.current.generation === generation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++request.current; };
  }, []);

  const refreshRuns = useCallback(async () => {
    const selectedRunWorkstreamId = workstreamId;
    const selectedGeneration = selection.current.generation;
    if (!isCurrentSelection(selectedRunWorkstreamId, selectedGeneration) || !selectedRunWorkstreamId) return false;
    const requestGeneration = ++request.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    const runs = [];
    const seenCursors = new Set();
    let cursor = null;
    let failure = null;
    do {
      let result;
      try {
        result = await api.query('run.list', {
          workstreamId: selectedRunWorkstreamId, statuses: OPEN_STATUSES, limit: 100,
          ...(cursor ? { cursor } : {})
        });
      } catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
      if (!isCurrentSelection(selectedRunWorkstreamId, selectedGeneration) || requestGeneration !== request.current) return false;
      if (result?.ok !== true) {
        failure = result?.error ?? { code: 'transport_unavailable' };
        break;
      }
      runs.push(...(Array.isArray(result.data?.items) ? result.data.items : []));
      const nextCursor = result.data?.nextCursor;
      cursor = typeof nextCursor === 'string' && nextCursor.trim() && !seenCursors.has(nextCursor) ? nextCursor : null;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    if (!isCurrentSelection(selectedRunWorkstreamId, selectedGeneration) || requestGeneration !== request.current) return false;
    if (failure) {
      setState((current) => ({ ...current, loading: false, error: failure, run: null }));
      return false;
    }
    setState((current) => ({ ...current, loading: false, error: null, run: currentRun(runs) }));
    return true;
  }, [api, workstreamId]);

  useEffect(() => {
    intents.current = new Map();
    setState({ loading: Boolean(workstreamId), submitting: false, error: null, run: null });
    if (workstreamId) void refreshRuns();
  }, [refreshRuns, workstreamId]);

  const command = useCallback(async (operation) => {
    const commandWorkstreamId = workstreamId;
    const commandGeneration = selection.current.generation;
    if (!isCurrentSelection(commandWorkstreamId, commandGeneration) || !commandWorkstreamId || state.submitting) return;
    const run = state.run;
    const isCreate = operation === 'create';
    if (!isCreate && (!run || !ACTIONS[run.status]?.includes(operation))) {
      if (mounted.current) setState((current) => ({ ...current, error: { code: 'invalid_transition' } }));
      return;
    }
    const identity = isCreate ? `create:${commandWorkstreamId}` : `${operation}:${run.id}:${run.version}`;
    if (!intents.current.has(identity)) {
      intents.current.set(identity, `web_run_${operation}_intent_${Date.now().toString(36)}_${++intentSequence.current}`);
    }
    const payload = isCreate
      ? { workstreamId: commandWorkstreamId, workerKind: 'pi', scope: 'Web Workbench interactive run' }
      : { runId: run.id };
    const options = {
      requestId: `web_run_${operation}_${Date.now().toString(36)}_${++requestSequence.current}`,
      idempotencyKey: intents.current.get(identity),
      ...(isCreate ? {} : { expectedVersion: run.version })
    };
    setState((current) => ({ ...current, submitting: true, error: null }));
    let result;
    try { result = await api.command(`run.${operation}`, payload, options); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!isCurrentSelection(commandWorkstreamId, commandGeneration)) return;
    await Promise.all([refreshRuns(), onAuthoritativeReload?.(commandWorkstreamId)]);
    if (!isCurrentSelection(commandWorkstreamId, commandGeneration)) return;
    setState((current) => ({ ...current, submitting: false, error: result?.ok === true ? null : (result?.error ?? { code: 'transport_unavailable' }) }));
  }, [api, onAuthoritativeReload, refreshRuns, state.run, state.submitting, workstreamId]);

  if (!workstreamId) return null;
  if (state.loading && !state.run) return createElement('p', { className: 'muted' }, 'Loading run…');
  const actions = state.run && !TERMINAL.has(state.run.status) ? (ACTIONS[state.run.status] ?? []) : ['create'];
  return createElement('section', { className: 'run-controls', 'data-run-controls': 'true' },
    createElement('h2', null, 'Run controls'),
    state.run ? createElement('p', null, 'Run ', createElement('strong', { 'data-run-status': 'true' }, state.run.status)) : createElement('p', null, 'No active run.'),
    state.error ? createElement('p', { role: 'alert' }, errorLabel(state.error)) : null,
    createElement('div', { className: 'run-actions' }, actions.map((action) => {
      const label = action === 'create' ? 'Create run' : actionLabel(action);
      return createElement('button', { key: action, type: 'button', 'data-run-action': label, disabled: state.submitting, onClick: () => command(action) }, state.submitting ? 'Working…' : label);
    }))
  );
}
