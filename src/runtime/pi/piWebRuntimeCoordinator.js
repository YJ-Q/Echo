function referenceId(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id;
  return null;
}

function runtimeReference(value) {
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string' || !value.kind.trim()) return null;
  const id = referenceId(value);
  return id ? { kind: value.kind, id } : null;
}

function operationIdentity(descriptor) {
  return JSON.stringify([descriptor?.operation ?? null, descriptor?.key ?? null, descriptor?.runtimeReference ?? null]);
}

function unavailableError() {
  return Object.freeze({ code: 'runtime_unavailable' });
}

function unavailableResult() {
  return { error: { code: 'runtime_unavailable', retryable: true } };
}

function sanitizeToolResult(value) {
  if (!value || typeof value !== 'object') return {};
  const boundedString = (item, max = 200) => typeof item === 'string' && item.trim() && item.length <= max ? item : undefined;
  const result = {
    ...(boundedString(value.toolName, 100) ? { toolName: value.toolName } : {}),
    ...(boundedString(value.code, 100) ? { code: value.code } : {}),
    ...(boundedString(value.auditId) ? { auditId: value.auditId } : {}),
    ...(boundedString(value.entityId) ? { entityId: value.entityId } : {}),
    ...(Number.isInteger(value.entityVersion) && value.entityVersion >= 0 ? { entityVersion: value.entityVersion } : {}),
    ...(typeof value.confirmationRequired === 'boolean' ? { confirmationRequired: value.confirmationRequired } : {})
  };
  const requestShape = sanitizeRequestShape(value.requestShape);
  return requestShape ? { ...result, requestShape } : result;
}

function sanitizeRequestShape(value) {
  if (!value || typeof value !== 'object') return null;
  const stringList = (items) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string' && item.trim() && item.length <= 200).slice(0, 20)
    : [];
  return {
    ...(typeof value.operation === 'string' && value.operation.trim() && value.operation.length <= 100 ? { operation: value.operation } : {}),
    ...(Array.isArray(value.fields) ? { fields: stringList(value.fields) } : {}),
    ...(Array.isArray(value.changeFields) ? { changeFields: stringList(value.changeFields) } : {})
  };
}

function ownsSession(record, run, reference) {
  const workstreamId = run?.workstreamId ?? run?.workstream_id;
  return record.runId === run?.id && record.workstreamId === workstreamId && record.kind === reference?.kind && record.session.id === reference?.id;
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
    const pending = Promise.resolve().then(effect).catch(() => {
      operations.delete(identity);
      throw unavailableError();
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
        const record = { session, runId: run.id, workstreamId, kind: 'pi', closed: false, turnTail: Promise.resolve() };
        sessions.set(session.id, record);
        return { runtimeSessionId: session.id };
      } catch { throw unavailableError(); }
    });
  }

  async function haltReference(run, reference) {
    const record = sessions.get(reference.id);
    if (record) {
      if (!ownsSession(record, run, reference)) throw unavailableError();
      if (!record.closed) {
        record.closed = true;
        sessions.delete(reference.id);
        await record.session.close();
      }
      return { halted: true };
    }
    if (reference.kind !== 'pi') throw unavailableError();
    if (typeof runtime.haltSession === 'function') {
      await runtime.haltSession(reference.id);
      return { halted: true };
    }
    return { halted: true, noOp: true };
  }

  async function halt(run, descriptor = {}) {
    return replay(descriptor, async () => {
      const reference = runtimeReference(descriptor.runtimeReference) ?? runtimeReference(run?.runtimeReference ?? run?.runtime_reference)
        ?? (typeof run?.runtime_session_id === 'string' ? { kind: 'pi', id: run.runtime_session_id } : null);
      if (!reference) return { halted: true, noOp: true };
      try { return await haltReference(run, reference); }
      catch { throw unavailableError(); }
    });
  }

  async function interact({ run, context, message } = {}) {
    const reference = runtimeReference(run?.runtimeReference ?? run?.runtime_reference);
    const record = reference ? sessions.get(reference.id) : null;
    if (!record || record.closed || !ownsSession(record, run, reference) || typeof message !== 'string') return unavailableResult();
    const turn = record.turnTail.then(async () => {
      try {
        const response = await record.session.send({ context, message });
        return {
          message: typeof response?.text === 'string' ? response.text : '',
          toolResults: Array.isArray(response?.toolResults) ? response.toolResults.map(sanitizeToolResult) : []
        };
      } catch { return unavailableResult(); }
    });
    record.turnTail = turn.then(() => undefined, () => undefined);
    return turn;
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
      throw unavailableError();
    });
    return reconcilePromise;
  }

  async function close() {
    if (closed) return;
    closed = true;
    let failure;
    for (const record of [...sessions.values()]) {
      try { await haltReference({ id: record.runId, workstreamId: record.workstreamId }, { kind: record.kind, id: record.session.id }); } catch (error) { failure ??= error; }
    }
    try { await runtime.close?.(); } catch { failure ??= unavailableError(); }
    if (failure) throw unavailableError();
  }

  return Object.freeze({ activate, halt, interact, reconcile, close });
}
