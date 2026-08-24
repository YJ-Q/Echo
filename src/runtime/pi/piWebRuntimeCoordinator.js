const TOOL_RESULT_FIELDS = Object.freeze([
  'toolName', 'code', 'auditId', 'entityId', 'entityVersion', 'confirmationRequired', 'requestShape'
]);

function referenceId(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id;
  return null;
}

function operationIdentity(descriptor) {
  return JSON.stringify([descriptor?.operation ?? null, descriptor?.key ?? null, descriptor?.runtimeReference ?? null]);
}

function unavailableError() {
  const error = new Error('runtime_unavailable');
  error.code = 'runtime_unavailable';
  return error;
}

function unavailableResult() {
  return { error: { code: 'runtime_unavailable', retryable: true } };
}

function sanitizeToolResult(value) {
  if (!value || typeof value !== 'object') return {};
  const result = Object.fromEntries(TOOL_RESULT_FIELDS.filter((field) => field !== 'requestShape')
    .filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));
  const requestShape = sanitizeRequestShape(value.requestShape);
  return requestShape ? { ...result, requestShape } : result;
}

function sanitizeRequestShape(value) {
  if (!value || typeof value !== 'object') return null;
  const stringList = (items) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string' && item.length <= 2_000).slice(0, 20)
    : [];
  return {
    ...(typeof value.operation === 'string' && value.operation.length <= 2_000 ? { operation: value.operation } : {}),
    ...(Array.isArray(value.fields) ? { fields: stringList(value.fields) } : {}),
    ...(Array.isArray(value.changeFields) ? { changeFields: stringList(value.changeFields) } : {})
  };
}

export function createPiWebRuntimeCoordinator({ runtime, tools, invocationContextFactory } = {}) {
  if (!runtime?.createSession || typeof invocationContextFactory !== 'function' || !tools) {
    throw new TypeError('invalid_pi_web_runtime_coordinator_dependencies');
  }
  const sessions = new Map();
  const operations = new Map();
  let reconcilePromise = null;
  let closed = false;

  function replay(descriptor, effect) {
    const identity = operationIdentity(descriptor);
    if (operations.has(identity)) return operations.get(identity);
    const pending = Promise.resolve().then(effect).catch((error) => {
      operations.delete(identity);
      throw error;
    });
    operations.set(identity, pending);
    return pending;
  }

  async function activate(run, descriptor = {}) {
    return replay(descriptor, async () => {
      if (closed) throw unavailableError();
      if (reconcilePromise) await reconcilePromise;
      const workstreamId = run?.workstreamId ?? run?.workstream_id;
      if (!run?.id || !workstreamId) throw unavailableError();
      try {
        const session = await runtime.createSession({
          getInvocationContext: (input = {}) => invocationContextFactory({
            run, descriptor, workstreamId, toolCallId: input.toolCallId
          })
        });
        if (!session?.id || typeof session.send !== 'function' || typeof session.close !== 'function') {
          await session?.close?.();
          throw unavailableError();
        }
        if (closed) {
          await session.close();
          throw unavailableError();
        }
        const record = { session, closed: false };
        sessions.set(session.id, record);
        return { runtimeSessionId: session.id };
      } catch (error) {
        if (error?.code === 'runtime_unavailable') throw error;
        throw unavailableError();
      }
    });
  }

  async function haltReference(id) {
    const record = sessions.get(id);
    if (record) {
      if (!record.closed) {
        record.closed = true;
        sessions.delete(id);
        await record.session.close();
      }
      return { halted: true };
    }
    if (typeof runtime.haltSession === 'function') {
      await runtime.haltSession(id);
      return { halted: true };
    }
    return { halted: true, noOp: true };
  }

  async function halt(run, descriptor = {}) {
    return replay(descriptor, async () => {
      const id = referenceId(descriptor.runtimeReference) ?? referenceId(run?.runtimeReference) ?? run?.runtime_session_id;
      if (!id) return { halted: true, noOp: true };
      try { return await haltReference(id); }
      catch { throw unavailableError(); }
    });
  }

  async function interact({ run, context, message } = {}) {
    const id = referenceId(run?.runtimeReference ?? run?.runtime_reference);
    const record = id ? sessions.get(id) : null;
    if (!record || record.closed || typeof message !== 'string') return unavailableResult();
    try {
      const response = await record.session.send({ context, message });
      return {
        message: typeof response?.text === 'string' ? response.text : '',
        toolResults: Array.isArray(response?.toolResults) ? response.toolResults.map(sanitizeToolResult) : []
      };
    } catch {
      return unavailableResult();
    }
  }

  async function reconcile(runningRuns, pause) {
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      if (!Array.isArray(runningRuns) || typeof pause !== 'function') throw new TypeError('invalid_runtime_reconciliation');
      for (const run of runningRuns) {
        await pause(run);
      }
    })().catch((error) => {
      reconcilePromise = null;
      throw error?.code === 'runtime_unavailable' ? error : unavailableError();
    });
    return reconcilePromise;
  }

  async function close() {
    if (closed) return;
    closed = true;
    let failure;
    for (const [id, record] of [...sessions]) {
      try { await haltReference(id); } catch (error) { failure ??= error; }
    }
    try { await runtime.close?.(); } catch { failure ??= unavailableError(); }
    if (failure) throw failure;
  }

  return Object.freeze({ activate, halt, interact, reconcile, close });
}
