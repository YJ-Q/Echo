const PERMISSION_BY_OPERATION = Object.freeze({
  memory_search: 'memoryRead',
  memory_propose: 'memoryPropose',
  state_update: 'stateWrite',
  action_update: 'actionWrite'
});

const CONFIRMATION_RISKS = new Set(['external_write', 'high_risk']);

export function decidePermission({ operation, permissions = {}, riskLevel, confirmationRef }) {
  const permission = PERMISSION_BY_OPERATION[operation];
  if (!permission || permissions[permission] !== true) {
    return { decision: 'denied', code: 'permission_denied' };
  }
  if (operation === 'action_update' && CONFIRMATION_RISKS.has(riskLevel) && !confirmationRef) {
    return { decision: 'confirmation_required', code: 'confirmation_required' };
  }
  return { decision: 'allowed', code: 'allowed' };
}
