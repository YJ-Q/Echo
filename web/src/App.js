import { createElement, useCallback, useEffect, useReducer } from 'react';
import { createApiClient } from './apiClient.js';
import { createInitialWorkbenchState, errorLabel, reduceWorkbenchState } from './workbenchState.js';

export function App({ api = createApiClient() }) {
  const [state, dispatch] = useReducer(reduceWorkbenchState, undefined, createInitialWorkbenchState);
  const load = useCallback(async () => {
    dispatch({ type: 'load_started' });
    const result = await api.query('workstream.list', {});
    if (result?.ok === true) dispatch({ type: 'load_succeeded' });
    else dispatch({ type: 'load_failed', error: result?.error ?? { code: 'transport_unavailable', retryable: true } });
  }, [api]);

  useEffect(() => { load(); }, [load]);

  let content = 'Loading workstreams…';
  if (!state.loading && state.error) content = errorLabel(state.error);
  else if (!state.loading) content = 'No workstreams yet.';

  return createElement('main', { className: 'workbench-shell' },
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workstreams' },
      createElement('h1', null, 'Workstreams'),
      createElement('p', null, content),
      state.error ? createElement('button', { type: 'button', onClick: load }, 'Retry') : null
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Workbench' },
      createElement('h2', null, 'Workbench'),
      createElement('p', null, 'Select a workstream to continue.')
    ),
    createElement('section', { className: 'workbench-region', 'aria-label': 'Activity' },
      createElement('h2', null, 'Activity'),
      createElement('p', null, 'Recent activity will appear here.')
    )
  );
}
