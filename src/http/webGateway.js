import { CONTRACT_VERSION } from '../contracts/contractTypes.js';
import { failureEnvelope, hasForbiddenBrowserField, sanitizeBrowserEnvelope } from './httpErrors.js';
import {
  WEB_COMMAND_CAPABILITIES,
  WEB_EVENT_CAPABILITIES,
  WEB_QUERY_CAPABILITIES
} from './webCapabilities.js';

export { WEB_COMMAND_CAPABILITIES, WEB_EVENT_CAPABILITIES, WEB_QUERY_CAPABILITIES } from './webCapabilities.js';

export function createWebGateway({ core, runtimeControl, instanceId, idFactory } = {}) {
  if (!core?.createApplicationContract || !core?.bindHostContext || typeof instanceId !== 'string' || !instanceId || typeof idFactory !== 'function') {
    throw new TypeError('invalid_web_gateway_dependencies');
  }
  const contract = core.createApplicationContract({ runtimeControl });
  if (!contract?.execute || !contract?.query || !contract?.events) throw new TypeError('invalid_application_contract');
  const correlationId = idFactory('web_correlation');

  async function dispatch(method, request, capabilities) {
    const requestId = request?.requestId;
    if (!isRequestId(requestId) || hasForbiddenBrowserField(request)) {
      return failureEnvelope({ code: 'invalid_request', requestId, correlationId });
    }
    const context = {
      actor: { type: 'user', subjectId: 'local-web-user' },
      surface: { kind: 'web', instanceId },
      requestId,
      correlationId,
      capabilities: [capabilities[request?.type]]
    };
    if (!context.capabilities[0]) return failureEnvelope({ code: 'invalid_request', requestId, correlationId });
    try {
      const trusted = core.bindHostContext(context);
      return sanitizeBrowserEnvelope(await contract[method](request, trusted), { requestId, correlationId });
    } catch {
      return failureEnvelope({ code: 'storage_failure', requestId, correlationId });
    }
  }

  const execute = (request) => dispatch('execute', request, WEB_COMMAND_CAPABILITIES);
  const query = (request) => dispatch('query', request, WEB_QUERY_CAPABILITIES);
  const events = (request) => dispatch('events', request, WEB_EVENT_CAPABILITIES);
  const internalQuery = (type, payload) => query({ type, requestId: idFactory('web_query_request'), payload });
  const internalEvents = (type, payload) => events({ type, requestId: idFactory('web_event_request'), payload });

  return Object.freeze({ execute, query, events, internalQuery, internalEvents });
}

export const WEB_CONTRACT_VERSION = CONTRACT_VERSION;

function isRequestId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 2_000;
}
