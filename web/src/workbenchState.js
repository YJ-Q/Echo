const STATUS_GROUPS = Object.freeze({
  running: 'active', ready: 'active', watching: 'active',
  waiting: 'attention', blocked: 'attention', needs_owner: 'attention', paused: 'attention',
  completed: 'complete', cancelled: 'complete', failed: 'complete'
});

const ERROR_LABELS = Object.freeze({
  transport_unavailable: 'Connection unavailable. Try again.',
  runtime_unavailable: 'The runtime is unavailable. Try again later.',
  version_conflict: 'This view is out of date. Refresh and try again.',
  permission_denied: 'This action is not available from the workbench.',
  not_found: 'The requested item is no longer available.',
  invalid_request: 'The request could not be completed.',
  storage_failure: 'The workbench could not load. Try again.'
});

export function createInitialWorkbenchState() {
  return { selectedId: null, tab: 'overview', formInput: '', loading: true, error: null, message: null, cursor: 0 };
}

export function reduceWorkbenchState(state, event) {
  switch (event.type) {
    case 'load_started': return { ...state, loading: true, error: null };
    case 'load_succeeded': return { ...state, loading: false, error: null };
    case 'load_failed': return { ...state, loading: false, error: event.error };
    case 'selected': return { ...state, selectedId: event.id ?? null };
    case 'tab_selected': return { ...state, tab: event.tab };
    case 'form_changed': return { ...state, formInput: event.value };
    case 'message_set': return { ...state, message: event.message ?? null };
    case 'cursor_set': return { ...state, cursor: Number.isInteger(event.cursor) ? event.cursor : state.cursor };
    default: return state;
  }
}

export function statusGroup(status) {
  return STATUS_GROUPS[status] ?? 'unknown';
}

export function errorLabel(error) {
  return ERROR_LABELS[error?.code] ?? 'The workbench could not load. Try again.';
}
