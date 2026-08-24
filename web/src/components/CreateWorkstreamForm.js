import { createElement, useRef, useState } from 'react';
import { errorLabel } from '../workbenchState.js';

function fieldError(title, goal, scenario) {
  if (!title.trim()) return 'Title is required.';
  if (!goal.trim()) return 'Goal is required.';
  if (!['career_project', 'learning_research'].includes(scenario)) return 'Scenario is required.';
  return null;
}

export function CreateWorkstreamForm({ api, onCreated }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [scenario, setScenario] = useState('career_project');
  const [state, setState] = useState({ submitting: false, error: null });
  const sequence = useRef(0);

  const submit = async (event) => {
    event.preventDefault();
    const validation = fieldError(title, goal, scenario);
    if (validation) { setState({ submitting: false, error: validation }); return; }
    const suffix = `${Date.now().toString(36)}_${++sequence.current}`;
    setState({ submitting: true, error: null });
    const result = await api.command('workstream.create', { title: title.trim(), goal: goal.trim(), scenario }, {
      requestId: `web_workstream_create_${suffix}`,
      idempotencyKey: `web_workstream_create_intent_${suffix}`
    });
    if (result?.ok !== true) { setState({ submitting: false, error: errorLabel(result?.error) }); return; }
    setTitle(''); setGoal(''); setScenario('career_project'); setState({ submitting: false, error: null });
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
