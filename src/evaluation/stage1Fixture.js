export const STAGE1_PROTOCOL_VERSION = '1.0.0';
export const STAGE1_SCENARIOS = Object.freeze(['learning_research', 'career_project']);
export const STAGE1_FAILURE_LABELS = Object.freeze([
  'missing_required_context',
  'incorrect_recovery',
  'stale_state_override',
  'cross_project_contamination',
  'unnecessary_background_request',
  'unsupported_memory_claim',
  'unauthorized_tool_attempt',
  'recap_without_progress',
  'intrusive_recall'
]);
export const STAGE1_ALLOWED_TOOLS = Object.freeze([
  'memory_search',
  'memory_propose',
  'state_update',
  'action_update'
]);

function invalid(reason) {
  const error = new Error(`Invalid Stage 1 fixture: ${reason}`);
  error.code = 'invalid_stage1_fixture';
  throw error;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function validateFact(fact) {
  return fact && nonEmptyString(fact.id) && nonEmptyString(fact.value) &&
    nonEmptyString(fact.sourceId) && Number.isInteger(fact.version) && fact.version > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function validateStage1Fixture(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected object');
  if (!nonEmptyString(value.taskId) || !/^(lr|cp)-[a-z0-9-]+-\d{3}$/u.test(value.taskId)) invalid('invalid taskId');
  if (value.protocolVersion !== STAGE1_PROTOCOL_VERSION) invalid('protocol mismatch');
  if (!STAGE1_SCENARIOS.includes(value.scenario)) invalid('unknown scenario');
  if (value.synthetic !== true || value.containsRealPersonalData !== false) invalid('fixtures must be synthetic');
  if (!nonEmptyString(value.projectId)) invalid('invalid projectId');
  if (!value.priorSession || value.priorSession.kind !== 'sustained_task' ||
      !nonEmptyString(value.priorSession.interruptionPoint) || !nonEmptyStrings(value.priorSession.messages)) {
    invalid('invalid priorSession');
  }
  if (!Array.isArray(value.currentFacts) || value.currentFacts.length === 0 || !value.currentFacts.every(validateFact)) {
    invalid('invalid currentFacts');
  }
  if (!Array.isArray(value.distractors) || !value.distractors.every((fact) => validateFact(fact) && nonEmptyString(fact.kind))) {
    invalid('invalid distractors');
  }
  const allFacts = [...value.currentFacts, ...value.distractors];
  if (new Set(allFacts.map((fact) => fact.id)).size !== allFacts.length) invalid('duplicate fact id');
  if (!nonEmptyString(value.newSessionRequest)) invalid('invalid newSessionRequest');
  if (!value.oracle || !nonEmptyStrings(value.oracle.requiredFactIds) || !Array.isArray(value.oracle.forbiddenFactIds)) {
    invalid('invalid fact oracle');
  }
  const currentIds = new Set(value.currentFacts.map((fact) => fact.id));
  const distractorIds = new Set(value.distractors.map((fact) => fact.id));
  if (!value.oracle.requiredFactIds.every((id) => currentIds.has(id)) ||
      !value.oracle.forbiddenFactIds.every((id) => distractorIds.has(id))) {
    invalid('oracle references unknown facts');
  }
  if (!value.oracle.artifact || !nonEmptyString(value.oracle.artifact.type) ||
      !nonEmptyStrings(value.oracle.artifact.checks)) invalid('invalid artifact');
  if (!Array.isArray(value.oracle.allowedTools) ||
      !value.oracle.allowedTools.every((tool) => STAGE1_ALLOWED_TOOLS.includes(tool))) invalid('unsupported tool');
  if (!Array.isArray(value.oracle.confirmationRequiredFor) ||
      !value.oracle.confirmationRequiredFor.every((tool) => value.oracle.allowedTools.includes(tool))) {
    invalid('invalid confirmation requirements');
  }
  if (!['allowed', 'forbidden', 'required'].includes(value.oracle.clarification)) invalid('invalid clarification rule');
  if (!nonEmptyStrings(value.oracle.expectedFailureLabels) ||
      !value.oracle.expectedFailureLabels.every((label) => STAGE1_FAILURE_LABELS.includes(label))) {
    invalid('unknown failure label');
  }
  if (!nonEmptyStrings(value.risks) || !value.risks.every((risk) => STAGE1_FAILURE_LABELS.includes(risk))) {
    invalid('unknown risk');
  }
  if (value.durableStateQualified !== true) invalid('durable state is not qualified');
  return deepFreeze(structuredClone(value));
}

export function summarizeStage1Fixtures(fixtures) {
  const validated = fixtures.map(validateStage1Fixture);
  const byScenario = {};
  const byRisk = {};
  for (const fixture of validated) {
    byScenario[fixture.scenario] = (byScenario[fixture.scenario] ?? 0) + 1;
    for (const risk of fixture.risks) byRisk[risk] = (byRisk[risk] ?? 0) + 1;
  }
  const sorted = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return {
    protocolVersion: STAGE1_PROTOCOL_VERSION,
    total: validated.length,
    byScenario: sorted(byScenario),
    byRisk: sorted(byRisk)
  };
}
