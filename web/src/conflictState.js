const CONFLICT_KEYS = ['entityLabel', 'originalValue', 'currentValue', 'proposedValue', 'currentVersion'];

export function createConflict(value) {
  if (!value || typeof value !== 'object') throw new TypeError('invalid_conflict');
  for (const key of Object.keys(value)) { if (!CONFLICT_KEYS.includes(key)) throw new TypeError('invalid_conflict'); }
  if (!Number.isInteger(value.currentVersion)) throw new TypeError('invalid_conflict');
  return Object.freeze(Object.fromEntries(CONFLICT_KEYS.map((k) => [k, value[k]])));
}
