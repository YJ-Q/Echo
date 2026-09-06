import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMarginApiClient } from './marginApiClient.js';
import { SessionBoard, UsageBar } from './SessionBoard.js';

const SETTINGS_KEY = 'margin.r3.settings';
const DEFAULT_SETTINGS = { showSummary: false, saveConfirmation: 'full' };
function readSettings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return DEFAULT_SETTINGS; } }

export function MarginApp({ api: suppliedApi }) {
  const api = useMemo(() => suppliedApi ?? createMarginApiClient(), [suppliedApi]);
  const [listState, setListState] = useState({ loading: true, error: null, sessions: [] });
  const [resourceStatus, setResourceStatus] = useState({ agents: [{ agent: 'codex', unavailable: true }, { agent: 'claude-code', unavailable: true }] });
  const [expanded, setExpanded] = useState(false); const [settings, setSettings] = useState(readSettings); const [alwaysOnTop, setAlwaysOnTop] = useState(false); const [toast, setToast] = useState(null); const toastTimer = useRef();
  const loadSessions = useCallback(({ quiet = false } = {}) => { if (!quiet) setListState((prev) => ({ ...prev, loading: true, error: null })); api.listSessions().then((result) => { if (result.ok) setListState({ loading: false, error: null, sessions: result.data.sessions }); else setListState((prev) => ({ loading: false, error: result.error?.message ?? 'Failed to load sessions', sessions: quiet ? prev.sessions : [] })); }).catch(() => setListState((prev) => ({ loading: false, error: 'Failed to load sessions', sessions: quiet ? prev.sessions : [] }))); }, [api]);
  const showToast = useCallback((message, kind = 'success') => { clearTimeout(toastTimer.current); setToast({ message, kind }); toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 3500 : 1800); }, []);
  const updateSettings = useCallback((patch) => setSettings((previous) => { const next = { ...previous, ...patch }; try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {} return next; }), []);
  const togglePin = useCallback(async () => { const next = await globalThis.marginShell?.toggleAlwaysOnTop?.(); if (typeof next === 'boolean') setAlwaysOnTop(next); }, []);
  // Resource status refresh keeps the last-known-good snapshot: a refresh that
  // fails or reads no trusted snapshot must never overwrite a value already
  // shown with the "unavailable" placeholder. Only a snapshot with resources
  // for the codex agent advances state, so the bar never flickers back to —.
  const loadResources = useCallback(() => { api.getResourceStatus?.().then((result) => { const codex = result?.agents?.find((agent) => agent.agent === 'codex'); if (codex?.resources?.length) setResourceStatus(result); }).catch(() => {}); }, [api]);
  const toggleExpanded = useCallback(() => setExpanded((value) => { const next = !value; globalThis.marginShell?.setExpanded?.(next); if (next) { loadSessions({ quiet: true }); loadResources(); } return next; }), [loadResources, loadSessions]);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { loadResources(); }, [loadResources]);
  useEffect(() => { globalThis.marginShell?.getAlwaysOnTop?.().then((value) => { if (typeof value === 'boolean') setAlwaysOnTop(value); }); }, []);
  useEffect(() => { if (!expanded) return undefined; const onFocus = () => { loadSessions({ quiet: true }); loadResources(); }; window.addEventListener('focus', onFocus); const interval = setInterval(() => { loadSessions({ quiet: true }); loadResources(); }, 30000); return () => { window.removeEventListener('focus', onFocus); clearInterval(interval); }; }, [expanded, loadResources, loadSessions]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  return createElement('main', { className: 'margin-shell' }, createElement(UsageBar, { resourceStatus, expanded, onToggle: toggleExpanded, settings, alwaysOnTop, onPin: togglePin, onHide: () => globalThis.marginShell?.hide?.(), onQuit: () => globalThis.marginShell?.quit?.() }), expanded ? createElement(SessionBoard, { api, sessions: listState.sessions, loading: listState.loading, error: listState.error, onRetry: loadSessions, settings, onSettingsChange: updateSettings, onToast: showToast, alwaysOnTop, onPin: togglePin }) : null, toast ? createElement('div', { className: `margin-toast ${toast.kind === 'error' ? 'is-error' : ''}`, role: 'status', title: toast.message }, toast.message) : null);
}
