import { createElement, useEffect, useState } from 'react';

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

// Session basics + Smart Handoff preview. Calls api.generateHandoff once per
// selected session; Save to Workspace and Copy both reuse the exact markdown
// this call returned — there is no second clipboard-specific rendering.
export function SessionDetail({ api, session }) {
  const [state, setState] = useState({ loading: true, error: null, markdown: null, resumeSummary: null });
  const [saveState, setSaveState] = useState({ status: 'idle', path: null, error: null });
  const [copyState, setCopyState] = useState('idle');
  const [showFullCheckpoint, setShowFullCheckpoint] = useState(false);

  const generate = () => {
    setState({ loading: true, error: null, markdown: null, resumeSummary: null });
    setSaveState({ status: 'idle', path: null, error: null });
    setCopyState('idle');
    return api.generateHandoff({ sessionId: session.id, repo: session.cwd });
  };

  useEffect(() => {
    let cancelled = false;
    setShowFullCheckpoint(false);
    generate().then((result) => {
      if (cancelled) return;
      if (result.ok) setState({ loading: false, error: null, markdown: result.data.markdown, resumeSummary: result.data.resumeSummary });
      else setState({ loading: false, error: result.error?.message ?? 'Failed to generate checkpoint', markdown: null, resumeSummary: null });
    });
    return () => { cancelled = true; };
  }, [api, session.id, session.cwd]);

  async function handleRetry() {
    const result = await generate();
    if (result.ok) setState({ loading: false, error: null, markdown: result.data.markdown, resumeSummary: result.data.resumeSummary });
    else setState({ loading: false, error: result.error?.message ?? 'Failed to generate checkpoint', markdown: null, resumeSummary: null });
  }

  async function handleSave() {
    setSaveState({ status: 'saving', path: null, error: null });
    const result = await api.saveToWorkspace({ repo: session.cwd, markdown: state.markdown });
    if (result.ok) setSaveState({ status: 'saved', path: result.data.path, error: null });
    else setSaveState({ status: 'error', path: null, error: result.error?.message ?? 'Save failed' });
  }

  async function handleCopy() {
    try {
      const copied = await copyToClipboard(state.markdown);
      setCopyState(copied ? 'copied' : 'error');
    } catch {
      setCopyState('error');
    }
  }

  return createElement('div', { className: 'margin-session-detail' },
    createElement('h2', null, session.label ?? (session.summary ? session.summary.trim().slice(0, 80) : session.id)),
    createElement('dl', { className: 'margin-session-facts' },
      fact('Agent', session.agent),
      fact('Workspace', session.cwd),
      fact('Updated', session.updatedAt)
    ),
    createElement('h3', null, 'Continue in another coding agent'),
    createElement('p', { className: 'margin-muted' }, 'A fresh portable checkpoint from this session and the current workspace.'),
    state.loading ? createElement('p', { className: 'margin-muted' }, 'Preparing fresh checkpoint…') : null,
    state.error ? createElement('div', null,
      createElement('p', { role: 'alert', className: 'margin-error' }, state.error),
      createElement('button', { type: 'button', onClick: handleRetry }, 'Retry')
    ) : null,
    state.resumeSummary ? createElement(ResumeSummary, { summary: state.resumeSummary }) : null,
    state.markdown ? createElement('div', { className: 'margin-handoff-actions' },
      createElement('button', { type: 'button', className: 'margin-primary-action', onClick: handleCopy }, 'Copy checkpoint'),
      createElement('button', { type: 'button', onClick: handleSave, disabled: saveState.status === 'saving' }, 'Save to workspace'),
      saveState.status === 'saved' ? createElement('span', { className: 'margin-status-note' }, 'Saved current checkpoint to .margin/HANDOFF.md. It will not update automatically.') : null,
      saveState.status === 'error' ? createElement('span', { className: 'margin-status-note margin-error' }, saveState.error) : null,
      copyState === 'copied' ? createElement('span', { className: 'margin-status-note' }, 'Copied') : null,
      copyState === 'error' ? createElement('span', { className: 'margin-status-note margin-error' }, 'Couldn’t copy checkpoint') : null
    ) : null,
    state.markdown ? createElement('div', { className: 'margin-full-checkpoint' },
      createElement('button', { type: 'button', className: 'margin-link-button', onClick: () => setShowFullCheckpoint((shown) => !shown) },
        showFullCheckpoint ? 'Hide full checkpoint' : 'View full checkpoint'),
      showFullCheckpoint ? createElement('pre', { className: 'margin-handoff-preview' }, state.markdown) : null
    ) : null
  );
}

function ResumeSummary({ summary }) {
  return createElement('div', { className: 'margin-resume-summary' },
    summarySection('Goal', summary.goal?.text, 'From the selected session'),
    summarySection('Progress', summary.progress?.map((item) => item.text), null),
    summarySection('Current applicability', summary.currentApplicability?.text, null),
    summarySection('Current validation', summary.currentValidation?.text, null)
  );
}

function summarySection(title, content, hint) {
  const values = Array.isArray(content) ? content : [content ?? 'Unknown'];
  return createElement('section', { className: 'margin-summary-section', key: title },
    createElement('h4', null, title),
    hint ? createElement('p', { className: 'margin-summary-hint' }, hint) : null,
    values.map((value, index) => createElement('p', { key: index }, value))
  );
}

function fact(label, value) {
  return createElement('div', { key: label, className: 'margin-fact-row' },
    createElement('dt', null, label),
    createElement('dd', null, value ?? 'Unknown')
  );
}
