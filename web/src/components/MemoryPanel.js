import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

function failure(result) { return result?.error ?? { code: 'transport_unavailable', retryable: true }; }

export function MemoryPanel({ api, workstreamId, onAuthoritativeReload }) {
  const [state, setState] = useState({ loading: false, error: null, items: [], query: '', includeArchive: false });
  const mounted = useRef(false);
  const request = useRef(0);
  const selection = useRef({ id: workstreamId, generation: 0 });
  const intentSeq = useRef(0);
  const intents = useRef(new Map());
  if (selection.current.id !== workstreamId) {
    selection.current = { id: workstreamId, generation: selection.current.generation + 1 };
    ++request.current;
  }
  const isCurrent = (id, gen) => mounted.current && selection.current.id === id && selection.current.generation === gen;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);

  const load = useCallback(async (query = '', includeArchive = false) => {
    const id = workstreamId;
    const gen = selection.current.generation;
    if (!id || !isCurrent(id, gen)) return;
    const loadRequest = ++request.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    let result;
    try {
      if (query.trim()) {
        result = await api.query('memory.search', { workstreamId: id, query: query.trim(), includeArchive, limit: 50 });
      } else {
        const statuses = includeArchive ? ['candidate', 'active', 'archive'] : ['active'];
        result = await api.query('memory.list', { workstreamId: id, lifecycleStatuses: statuses, limit: 50 });
      }
    } catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!isCurrent(id, gen) || loadRequest !== request.current) return;
    if (result?.ok !== true) { setState((s) => ({ ...s, loading: false, error: failure(result) })); return; }
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    setState((s) => ({ ...s, loading: false, error: null, items }));
  }, [api, workstreamId]);

  useEffect(() => {
    intents.current = new Map();
    setState({ loading: Boolean(workstreamId), error: null, items: [], query: '', includeArchive: false });
    if (workstreamId) void load();
  }, [load, workstreamId]);

  const mutate = useCallback(async (command, payload, memoryId, version) => {
    const id = workstreamId;
    const gen = selection.current.generation;
    if (!isCurrent(id, gen)) return;
    const identity = `${command}:${memoryId}:${version}`;
    if (!intents.current.has(identity)) {
      intents.current.set(identity, `web_mem_${command}_${Date.now().toString(36)}_${++intentSeq.current}`);
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    let result;
    try { result = await api.command(command, payload, { requestId: `web_mem_${Date.now().toString(36)}`, idempotencyKey: intents.current.get(identity), expectedVersion: version }); }
    catch { result = { ok: false, error: { code: 'transport_unavailable', retryable: true } }; }
    if (!isCurrent(id, gen)) return;
    if (result?.ok !== true) { setState((s) => ({ ...s, loading: false, error: failure(result) })); return; }
    await load(state.query, state.includeArchive);
    onAuthoritativeReload?.(id, () => isCurrent(id, gen));
  }, [api, load, onAuthoritativeReload, state.includeArchive, state.query, workstreamId]);

  if (!workstreamId) return null;
  const { items, loading, error, query, includeArchive } = state;
  return createElement('section', { className: 'memory-panel', 'data-memory-panel': 'true' },
    createElement('h3', null, 'Memories'),
    error ? createElement('p', { role: 'alert' }, errorLabel(error)) : null,
    createElement('div', { className: 'memory-search-bar' },
      createElement('input', {
        type: 'search', placeholder: 'Search memories…', value: query, 'data-memory-search': 'true',
        disabled: loading,
        onInput: (e) => { const q = e.target.value; setState((s) => ({ ...s, query: q })); void load(q, includeArchive); }
      }),
      createElement('label', null,
        createElement('input', { type: 'checkbox', checked: includeArchive, 'data-memory-archive-toggle': 'true', onChange: (e) => { const a = e.target.checked; setState((s) => ({ ...s, includeArchive: a })); void load(query, a); } }),
        ' Include archive'
      )
    ),
    loading && !items.length ? createElement('p', { className: 'muted' }, 'Loading memories…') : null,
    !loading && !items.length ? createElement('p', { className: 'muted' }, 'No memories found.') : null,
    createElement('ul', { className: 'memory-list' }, items.map((item) =>
      createElement('li', { key: item.id, className: 'memory-item', 'data-memory-item': item.id },
        createElement('p', null, item.content),
        createElement('span', { className: 'muted' }, `${item.lifecycleStatus} · ${item.source?.kind ?? 'unknown'}`),
        createElement('div', { className: 'memory-actions' },
          item.lifecycleStatus === 'candidate' ? createElement('button', { type: 'button', 'data-memory-confirm': item.id, disabled: loading, onClick: () => mutate('memory.confirm', { memoryId: item.id }, item.id, item.version) }, 'Confirm') : null,
          item.lifecycleStatus === 'active' ? createElement('button', { type: 'button', 'data-memory-archive': item.id, disabled: loading, onClick: () => mutate('memory.archive', { memoryId: item.id }, item.id, item.version) }, 'Archive') : null,
          item.lifecycleStatus === 'archive' ? createElement('button', { type: 'button', 'data-memory-restore': item.id, disabled: loading, onClick: () => mutate('memory.restore', { memoryId: item.id }, item.id, item.version) }, 'Restore') : null
        )
      )
    ))
  );
}
