import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GROUPS = Object.freeze(['Running', 'Needs Owner', 'Waiting', 'Paused', 'Completed']);

function failure(result) {
  return result?.error ?? { code: 'transport_unavailable', retryable: true };
}

function groupFor(workstream, openNeedsByWorkstreamId) {
  if (workstream.status === 'running') return 'Running';
  if (openNeedsByWorkstreamId.has(workstream.id) || workstream.status === 'needs_owner') return 'Needs Owner';
  if (['ready', 'waiting', 'watching', 'blocked'].includes(workstream.status)) return 'Waiting';
  if (workstream.status === 'paused') return 'Paused';
  return 'Completed';
}

function rowsFor(workstreams, needsOwner) {
  const openNeedsByWorkstreamId = new Set(needsOwner
    .filter((item) => item?.status === 'open' && typeof item.workstreamId === 'string')
    .map((item) => item.workstreamId));
  return workstreams.map((workstream) => ({
    workstream,
    group: groupFor(workstream, openNeedsByWorkstreamId),
    hasOpenNeedsOwner: openNeedsByWorkstreamId.has(workstream.id)
  }));
}

export function useWorkbenchData(api) {
  const [workstreams, setWorkstreams] = useState([]);
  const [needsOwner, setNeedsOwner] = useState([]);
  const [listState, setListState] = useState({ loading: true, error: null });
  const [selectedId, setSelectedId] = useState(null);
  const [detailState, setDetailState] = useState({ loading: false, error: null, workstream: null });
  const detailRequest = useRef(0);

  const refreshWorkstreams = useCallback(async () => {
    setListState({ loading: true, error: null });
    const [workstreamResult, needsOwnerResult] = await Promise.all([
      api.query('workstream.list', {}), api.query('needs_owner.list', { statuses: ['open'] })
    ]);
    if (workstreamResult?.ok !== true) {
      setListState({ loading: false, error: failure(workstreamResult) });
      return false;
    }
    if (needsOwnerResult?.ok !== true) {
      setListState({ loading: false, error: failure(needsOwnerResult) });
      return false;
    }
    setWorkstreams(Array.isArray(workstreamResult.data?.items) ? workstreamResult.data.items : []);
    setNeedsOwner(Array.isArray(needsOwnerResult.data?.items) ? needsOwnerResult.data.items : []);
    setListState({ loading: false, error: null });
    return true;
  }, [api]);

  const refreshWorkstream = useCallback(async (id = selectedId) => {
    if (typeof id !== 'string' || !id) return false;
    const request = ++detailRequest.current;
    setDetailState({ loading: true, error: null, workstream: null });
    const result = await api.query('workstream.get', { workstreamId: id });
    if (request !== detailRequest.current) return false;
    if (result?.ok !== true) {
      setDetailState({ loading: false, error: failure(result), workstream: null });
      return false;
    }
    setDetailState({ loading: false, error: null, workstream: result.data });
    return true;
  }, [api, selectedId]);

  const selectWorkstream = useCallback(async (id) => {
    setSelectedId(id);
    return refreshWorkstream(id);
  }, [refreshWorkstream]);

  const createdWorkstream = useCallback(async (id) => {
    const reloaded = await refreshWorkstreams();
    if (reloaded) await selectWorkstream(id);
  }, [refreshWorkstreams, selectWorkstream]);

  useEffect(() => { refreshWorkstreams(); }, [refreshWorkstreams]);

  const rows = useMemo(() => rowsFor(workstreams, needsOwner), [workstreams, needsOwner]);
  const groups = useMemo(() => GROUPS.map((name) => ({ name, rows: rows.filter((row) => row.group === name) })), [rows]);

  return {
    groups, selectedId, selectWorkstream, refreshWorkstreams, refreshWorkstream,
    createdWorkstream, listState, detailState
  };
}
