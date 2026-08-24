import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

const JSON_LIMIT = 2000;

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') return 'Unavailable';
    return text.length > JSON_LIMIT ? `${text.slice(0, JSON_LIMIT)}…` : text;
  } catch { return 'Unavailable'; }
}

function safeHttpsUrl(uri) {
  if (typeof uri !== 'string' || !uri.trim() || /[\\\u0000-\u001f]/.test(uri)) return null;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch { return null; }
}

function failure(result) { return result?.error ?? { code: 'transport_unavailable', retryable: true }; }

export function ArtifactPanel({ api, workstreamId }) {
  const [state, setState] = useState({ loading: false, error: null, items: [] });
  const mounted = useRef(false);
  const request = useRef(0);
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
    setState({ loading: true, error: null, items: [] });
    const items = [];
    const seen = new Set();
    let cursor = null;
    do {
      let result;
      try { result = await api.query('artifact.list', { workstreamId: id, limit: 100, ...(cursor ? { cursor } : {}) }); }
      catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
      if (!isCurrent(id, generation) || loadRequest !== request.current) return false;
      if (result?.ok !== true) {
        setState({ loading: false, error: failure(result), items: [] });
        return false;
      }
      items.push(...(Array.isArray(result.data?.items) ? result.data.items : []));
      const nextCursor = result.data?.nextCursor;
      cursor = typeof nextCursor === 'string' && nextCursor.trim() && !seen.has(nextCursor) ? nextCursor : null;
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (!isCurrent(id, generation) || loadRequest !== request.current) return false;
    setState({ loading: false, error: null, items });
    return true;
  }, [api, workstreamId]);

  useEffect(() => {
    setState({ loading: Boolean(workstreamId), error: null, items: [] });
    if (workstreamId) void load();
  }, [load, workstreamId]);

  if (!workstreamId) return null;
  return createElement('section', { className: 'artifact-panel', 'data-artifact-panel': 'true' },
    createElement('h2', null, 'Artifacts'),
    state.error ? createElement('p', { role: 'alert' }, errorLabel(state.error)) : null,
    state.loading ? createElement('p', { className: 'muted' }, 'Loading artifacts…') : null,
    !state.loading && !state.items.length ? createElement('p', { className: 'muted' }, 'No artifacts yet.') : null,
    createElement('ul', null, state.items.map((item) => artifact(item)))
  );
}

function artifact(item) {
  const uri = item?.resourceReference?.uri;
  const safeUrl = safeHttpsUrl(uri);
  return createElement('li', { key: item.id, className: 'artifact-item' },
    createElement('strong', null, item.title),
    line('Type', item.type), line('Source', item.source?.createdBy), line('Run', item.runId), line('Version', Number.isInteger(item.version) ? String(item.version) : null), line('Date', item.createdAt),
    line('Resource', safeUrl
      ? createElement('a', { href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }, uri)
      : typeof uri === 'string' ? uri : null),
    line('Content hash', item.resourceReference?.contentHash), line('Metadata', safeJson(item.metadata)), line('Preview metadata', safeJson(item.previewMetadata))
  );
}

function line(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return createElement('p', { key: label }, createElement('strong', null, `${label}: `), value);
}
