import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

function failure(result) { return result?.error ?? { code: 'transport_unavailable', retryable: true }; }

export function ResumeBriefPanel({ api, workstreamId, onSwitchRequest }) {
  const [state, setState] = useState({ loading: false, error: null, brief: null });
  const mounted = useRef(false);
  const request = useRef(0);
  const selection = useRef({ id: workstreamId, generation: 0 });
  if (selection.current.id !== workstreamId) {
    selection.current = { id: workstreamId, generation: selection.current.generation + 1 };
    ++request.current;
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);

  const load = useCallback(async () => {
    const id = workstreamId;
    const gen = selection.current.generation;
    if (!id) return;
    const loadRequest = ++request.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    let result;
    try { result = await api.query('resume_brief.get', { workstreamId: id }); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!mounted.current || loadRequest !== request.current || selection.current.generation !== gen) return;
    if (result?.ok !== true) {
      setState((s) => ({ ...s, loading: false, error: failure(result) }));
      return;
    }
    setState({ loading: false, error: null, brief: result.data });
  }, [api, workstreamId]);

  useEffect(() => {
    setState({ loading: Boolean(workstreamId), error: null, brief: null });
    if (workstreamId) void load();
  }, [load, workstreamId]);

  if (!workstreamId) return null;
  const { brief, loading, error } = state;
  return createElement('section', { className: 'resume-brief-panel', 'data-resume-brief-panel': 'true' },
    createElement('h3', null, 'Resume Brief'),
    error ? createElement('p', { role: 'alert' }, errorLabel(error)) : null,
    loading && !brief ? createElement('p', { className: 'muted' }, 'Loading brief…') : null,
    brief ? createElement('div', null,
      brief.facts?.nextAction ? createElement('p', null, createElement('strong', null, 'Next: '), brief.facts.nextAction) : null,
      brief.facts?.goal ? createElement('p', null, createElement('strong', null, 'Goal: '), brief.facts.goal) : null,
      Array.isArray(brief.recommendations) && brief.recommendations.length
        ? createElement('div', { className: 'resume-brief-recommendations' },
          createElement('h4', null, 'Recommended action'),
          brief.recommendations.slice(0, 1).map((rec) => createElement('p', { key: rec.id, 'data-recommendation': rec.kind }, rec.action))
        ) : null,
      Array.isArray(brief.needsOwner) && brief.needsOwner.length
        ? createElement('p', { className: 'muted' }, `${brief.needsOwner.length} open decision(s) require your input.`) : null,
      brief.run ? createElement('p', null, createElement('strong', null, 'Active run: '), brief.run.status) : null,
      onSwitchRequest ? createElement('button', {
        type: 'button', className: 'resume-brief-switch', 'data-resume-brief-switch': 'true',
        onClick: () => onSwitchRequest(workstreamId, brief)
      }, 'Switch to this workstream') : null
    ) : null
  );
}
