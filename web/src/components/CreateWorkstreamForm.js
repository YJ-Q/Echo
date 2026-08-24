import { createElement, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

function fieldError(title, goal, scenario) {
  if (!title.trim()) return 'Title is required.';
  if (!goal.trim()) return 'Goal is required.';
  if (!['career_project', 'learning_research'].includes(scenario)) return 'Scenario is required.';
  return null;
}

export function CreateWorkstreamForm({ api, onCreated, onUncertain }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [scenario, setScenario] = useState('career_project');
  const [state, setState] = useState({ submitting: false, error: null });
  const requestSequence = useRef(0);
  const intentSequence = useRef(0);
  const intent = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const validation = fieldError(title, goal, scenario);
    if (validation) { setState({ submitting: false, error: validation }); return; }
    const payload = { title: title.trim(), goal: goal.trim(), scenario };
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.fingerprint !== fingerprint) {
      intent.current = {
        fingerprint,
        idempotencyKey: `web_workstream_create_intent_${Date.now().toString(36)}_${++intentSequence.current}`
      };
    }
    setState({ submitting: true, error: null });
    let result;
    try {
      result = await api.command('workstream.create', payload, {
        requestId: `web_workstream_create_${Date.now().toString(36)}_${++requestSequence.current}`,
        idempotencyKey: intent.current.idempotencyKey
      });
    } catch {
      result = { ok: false, error: { code: 'transport_unavailable', retryable: true } };
    }
    if (result?.ok !== true) {
      await onUncertain?.();
      setState({ submitting: false, error: errorLabel(result?.error) });
      return;
    }
    setTitle(''); setGoal(''); setScenario('career_project'); setState({ submitting: false, error: null });
    intent.current = null;
    await onCreated(result.data.id);
  };

  return createElement('form', { 'data-create-workstream': 'true', onSubmit: submit },
    createElement('h2', null, 'Create workstream'),
    createElement('label', null, 'Title', createElement('input', { value: title, maxLength: 2000, onInput: (event) => setTitle(event.target.value) })),
    createElement('label', null, 'Goal', createElement('input', { value: goal, maxLength: 2000, onInput: (event) => setGoal(event.target.value) })),
    createElement('label', null, 'Scenario', createElement('select', { value: scenario, onChange: (event) => setScenario(event.target.value) },
      createElement('option', { value: 'career_project' }, 'Career project'),
      createElement('option', { value: 'learning_research' }, 'Learning research')
    )),
    state.error ? createElement('p', { role: 'alert' }, state.error) : null,
    createElement('button', { type: 'submit', disabled: state.submitting }, state.submitting ? 'Creating…' : 'Create')
  );
}
