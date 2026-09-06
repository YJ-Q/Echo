// Browser-safe, intentionally small projection of the existing distilled
// state. This module does not inspect raw evidence or make new conclusions.
// It only selects existing semantic facts for the resume-first UI.

const PROGRESS_LIMIT = 3;

const progressPriority = {
  'assistant-report': 0,
  'historical-validation': 1,
  'structured-work': 2,
  'current-corroboration': 3,
  'current-validation': 4,
};

function unknown(text) {
  return { status: 'unknown', text };
}

function projectGoal(goal) {
  const item = Array.isArray(goal) ? goal[0] : null;
  return item
    ? { text: item.text, confidence: item.confidence ?? 'Unknown' }
    : unknown('No source-backed goal available from the selected session.');
}

function projectProgress(progress) {
  const selected = (Array.isArray(progress) ? progress : [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (progressPriority[a.item.kind] ?? 99) - (progressPriority[b.item.kind] ?? 99) || a.index - b.index)
    .slice(0, PROGRESS_LIMIT)
    .map(({ item }) => ({
      text: item.text,
      confidence: item.confidence ?? 'Unknown',
      temporalScope: item.temporalScope ?? 'unknown',
      kind: item.kind ?? 'unknown',
    }));
  return selected.length ? selected : [{
    text: 'No source-backed progress available.', confidence: 'Unknown', temporalScope: 'unknown', kind: 'unknown'
  }];
}

function projectApplicability(state, truth) {
  const historicalIntent = (state?.nextStep ?? []).some((item) =>
    item.basis === 'Next action inferred from the latest explicit assistant implementation/handoff commitment');
  const targets = (truth?.files ?? []).filter((file) => file.targetProvenance?.length);
  if (targets.length) {
    const present = targets.filter((file) => file.status === 'exists').length;
    return {
      status: 'reconciled',
      text: `${present}/${targets.length} structured historical target${targets.length === 1 ? '' : 's'} currently observable in the workspace.`,
    };
  }
  if (truth?.targetLinkage?.status === 'available') {
    return { status: 'reconciled', text: 'Structured target linkage is available, but no current file observation was retained.' };
  }
  if (truth?.targetLinkage) {
    return unknown('Repo target linkage is unavailable; current applicability is unknown.');
  }
  if (!historicalIntent) {
    return unknown('Historical intent is unavailable; current applicability is unknown.');
  }
  return unknown('Current repo reconciliation state is unavailable; current applicability is unknown.');
}

function projectValidation(progress) {
  const current = (Array.isArray(progress) ? progress : []).find((item) => item.kind === 'current-validation');
  return current
    ? { status: current.confidence === 'Uncertain' ? 'unknown' : 'available', text: current.text, confidence: current.confidence ?? 'Unknown' }
    : unknown('Current validation: unknown; no current validation evidence is available.');
}

export function projectResumeSummary(state = {}, truth) {
  return {
    goal: projectGoal(state.goal),
    progress: projectProgress(state.progress),
    currentApplicability: projectApplicability(state, truth),
    currentValidation: projectValidation(state.progress),
  };
}

export { PROGRESS_LIMIT };
