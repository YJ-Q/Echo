import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
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
  const requestSequence = useRef(0);
  const intentSequence = useRef(0);
  const intents = useRef(new Map());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++request.current; };
  }, []);

  const refreshRuns = useCallback(async () => {
    if (!mounted.current || !workstreamId) return false;
    const generation = ++request.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    let result;
    try { result = await api.query('run.list', { workstreamId }); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!mounted.current || generation !== request.current) return false;
    if (result?.ok !== true) {
      setState((current) => ({ ...current, loading: false, error: result?.error ?? { code: 'transport_unavailable' }, run: null }));
      return false;
    }
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    setState((current) => ({ ...current, loading: false, error: null, run: currentRun(items) }));
    return true;
  }, [api, workstreamId]);

  useEffect(() => {
    intents.current = new Map();
    setState({ loading: Boolean(workstreamId), submitting: false, error: null, run: null });
    if (workstreamId) void refreshRuns();
  }, [refreshRuns, workstreamId]);

  const reloadAuthority = useCallback(async () => {
    await Promise.all([refreshRuns(), onAuthoritativeReload?.(workstreamId)]);
  }, [onAuthoritativeReload, refreshRuns, workstreamId]);

  const command = useCallback(async (operation) => {
    if (!workstreamId || state.submitting) return;
    const run = state.run;
    const isCreate = operation === 'create';
    if (!isCreate && (!run || !ACTIONS[run.status]?.includes(operation))) {
      if (mounted.current) setState((current) => ({ ...current, error: { code: 'invalid_transition' } }));
      return;
    }
    const identity = isCreate ? `create:${workstreamId}` : `${operation}:${run.id}:${run.version}`;
    if (!intents.current.has(identity)) {
      intents.current.set(identity, `web_run_${operation}_intent_${Date.now().toString(36)}_${++intentSequence.current}`);
    }
    const payload = isCreate
      ? { workstreamId, workerKind: 'pi', scope: 'Web Workbench interactive run' }
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
    await reloadAuthority();
    if (!mounted.current) return;
    setState((current) => ({ ...current, submitting: false, error: result?.ok === true ? null : (result?.error ?? { code: 'transport_unavailable' }) }));
  }, [api, reloadAuthority, state.run, state.submitting, workstreamId]);

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
