import { COMMAND_TYPES, EVENT_QUERY_TYPES, QUERY_TYPES } from '../contracts/contractTypes.js';

function closedCapabilities(types, entries) {
  const map = Object.freeze(Object.fromEntries(entries));
  if (Object.keys(map).length !== types.length || types.some((type) => !(type in map))) {
    throw new TypeError('web_capability_map_mismatch');
  }
  return map;
}

export const WEB_COMMAND_CAPABILITIES = closedCapabilities(COMMAND_TYPES, [
  ['workstream.create', 'workstream:write'], ['workstream.update', 'workstream:write'],
  ['run.create', 'run:control'], ['run.start', 'run:control'], ['run.pause', 'run:control'],
  ['run.resume', 'run:control'], ['run.stop', 'run:control'],
  ['checkpoint.create', 'checkpoint:write'], ['artifact.create', 'artifact:write'],
  ['needs_owner.create', 'needs_owner:write'], ['needs_owner.resolve', 'needs_owner:resolve']
]);

export const WEB_QUERY_CAPABILITIES = closedCapabilities(QUERY_TYPES, [
  ['workstream.list', 'workstream:read'], ['workstream.get', 'workstream:read'],
  ['run.get', 'run:read'], ['run.list', 'run:read'], ['artifact.list', 'artifact:read'],
  ['decision.list', 'decision:read'], ['needs_owner.list', 'needs_owner:read'],
  ['activity.list', 'activity:read'], ['checkpoint.latest', 'checkpoint:read']
]);

export const WEB_EVENT_CAPABILITIES = closedCapabilities(EVENT_QUERY_TYPES, [
  ['event.list', 'event:read']
]);
