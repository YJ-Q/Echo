import { digestInput } from '../core/contracts.js';
import { formatMemory, formatState, parseTerminalInput } from './terminalCommands.js';
import { routeContinuityInput } from '../continuity/memoryWriteRouter.js';

const GOAL = '持续完成简历投递并维护投递记录';
const CONTINUE_QUERY = '继续简历投递和投递记录维护';

function classify(error) {
  return error?.code === 'PI_MODEL_UNAVAILABLE' || String(error?.code).startsWith('PI_')
    ? 'provider_unavailable'
    : 'pilot_failure';
}

export function createTerminalPilotController({ core, runtime, registry, clock, idFactory }) {
  if (!core?.workstreams || !core?.continuity || !core?.tools || !runtime?.createSession || !registry || !clock || !idFactory) {
    throw new TypeError('invalid_terminal_pilot_dependencies');
  }
  let project;
  let run;
  let session;
  let lastPlan;
  let closed = false;
  let sessionClosed = false;

  async function openSession() {
    session = await runtime.createSession({
      tools: core.v1Tools ?? core.tools,
      getInvocationContext: async ({ toolCallId }) => ({
        actorType: 'agent', subjectId: 'local-terminal-user',
        permissions: { memoryRead: true, memoryPropose: true, stateWrite: true, actionWrite: true },
        confirmations: [], sourceSessionId: session?.id, sourceEventId: toolCallId,
        projectId: project?.id
      })
    });
    sessionClosed = false;
    if (!session?.id || !session?.send || !session?.close) throw new TypeError('invalid_pilot_session');
    return session;
  }

  const runActor = (operation) => ({
    actorType: 'user', subjectId: 'local-terminal-user', sourceSessionId: session?.id ?? `host-${operation}`,
    sourceEventId: idFactory(`${operation}_event`)
  });
  const hostRunActor = (operation) => core.bindHostActor(runActor(operation));

  const runtimeControl = {
    async activate() {
      if (!session || sessionClosed) await openSession();
      return { runtimeSessionId: session.id };
    },
    async halt(runToHalt) {
      const persistedSessionId = runToHalt?.runtime_session_id;
      if (!sessionClosed && session && (!persistedSessionId || session.id === persistedSessionId)) {
        sessionClosed = true;
        await session.close();
      } else if (persistedSessionId) {
        await runtime.haltSession?.(persistedSessionId);
      }
    }
  };

  async function snapshot(query = CONTINUE_QUERY) {
    const base = await core.continuity.snapshot({ projectId: project.id, query, asOf: clock(), recentDialogue: [] });
    return { ...base, task: base.activeTask, tasks: base.activeTask ? [base.activeTask] : [], actions: base.actions ?? [] };
  }

  async function planned(query = CONTINUE_QUERY) {
    const current = await snapshot(query);
    const basePlan = await core.continuity.plan({ projectId: project.id, query, asOf: clock(), recentDialogue: [] });
    const actionEntries = current.actions.slice(0, 5).map((action) => ({
      sourceType: 'margin_action', entityType: 'action', entityId: action.id,
      version: action.version, sourceSessionId: action.source_session_id ?? null,
      reason: 'open_action', content: action.title, status: action.status
    }));
    const selected = [...basePlan.selected, ...actionEntries].slice(0, 12);
    lastPlan = { ...basePlan, selected, digest: digestInput({ selected, excluded: basePlan.excluded }) };
    return { current, plan: lastPlan };
  }

  async function start() {
    const savedId = await registry.load();
    project = savedId ? await core.workstreams.get(savedId) : null;
    if (!project || project.status === 'completed') {
      project = await core.workstreams.findByScenario('career_project');
      if (project) await registry.save(project.id);
    }
    if (!project || project.status === 'completed') {
      const input = {
        requestId: idFactory('create_workstream'), scenario: 'career_project', title: '简历投递与记录维护',
        goal: GOAL, currentPlan: ['继续投递并维护结构化记录'], nextAction: '记录下一次投递'
      };
      project = (await core.workstreams.create(input, runActor('create_workstream'))).data;
    }
    await registry.save(project.id);
    if (core.runs) {
      run = await core.runs.findOpen(project.id);
      if (run?.status === 'running') {
        run = (await core.runs.pause({ requestId: idFactory('reconcile_run'), runId: run.id, expectedVersion: run.version }, hostRunActor('reconcile_run'), runtimeControl)).data;
      }
      if (!run) {
        await openSession();
        run = (await core.runs.create({
          requestId: idFactory('create_run'), workstreamId: project.id,
          scope: '终端连续性试点', runtimeKind: 'pi'
        }, hostRunActor('create_run'))).data;
      }
      if (run.status === 'queued') {
        if (!session || sessionClosed) await openSession();
        run = (await core.runs.start({ requestId: idFactory('start_run'), runId: run.id, expectedVersion: run.version }, hostRunActor('start_run'), runtimeControl)).data;
      }
    } else {
      await openSession();
    }
    return { projectId: project.id, sessionId: session?.id ?? null, ...(run ? { runId: run.id, runStatus: run.status } : {}) };
  }

  async function sendMessage(message) {
    if (core.runs && run?.status !== 'running') {
      return { kind: 'error', code: 'run_not_running', text: '当前 Run 未运行，请先使用 /resume。', sessionId: session?.id, runId: run?.id };
    }
    try {
      const { plan } = await planned(message);
      const response = await session.send({ context: { ...plan, writeRouting: routeContinuityInput(message) }, message });
      const confirmations = (response?.toolResults ?? []).map((item) => {
        const entity = item.entityId ? ` entity=${item.entityId}${item.entityVersion ? ` v${item.entityVersion}` : ''}` : '';
        const confirmation = item.confirmationRequired ? ' 需确认' : '';
        const requestShape = item.requestShape
          ? ` request=${item.requestShape.operation ?? '-'} fields=${item.requestShape.fields.join(',')} changes=${item.requestShape.changeFields.join(',') || '-'}`
          : '';
        return `[工具 ${item.toolName}: ${item.code}${item.auditId ? ` audit=${item.auditId}` : ''}${entity}${confirmation}${requestShape}]`;
      });
      const failures = (response?.toolResults ?? []).filter((item) => item.code !== 'allowed');
      const writeWarning = failures.length
        ? `注意：部分更新未写入（${failures.map((item) => `${item.toolName}=${item.code}`).join('，')}）。以下模型表述不能作为写入成功凭证。`
        : '';
      return {
        kind: 'message', text: [writeWarning, response?.text ?? '', ...confirmations].filter(Boolean).join('\n'), sessionId: session.id,
        trace: {
          sessionId: session.id, projectId: project.id, contextDigest: plan.digest,
          resultCodes: response?.resultCodes ?? [],
          toolResults: (response?.toolResults ?? []).map(({ toolName, code, auditId, entityId, entityVersion, confirmationRequired, requestShape }) =>
            ({ toolName, code, auditId, entityId, entityVersion, confirmationRequired, ...(requestShape ? { requestShape } : {}) }))
        }
      };
    } catch (error) {
      const code = classify(error);
      return { kind: 'error', code, text: code === 'provider_unavailable' ? '模型暂时不可用，请稍后重试。' : '试点操作失败，请重试。', sessionId: session?.id };
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    let failure;
    try {
      if (core.runs && run?.status === 'running') {
        run = (await core.runs.pause({ requestId: idFactory('close_pause'), runId: run.id, expectedVersion: run.version }, hostRunActor('close_pause'), runtimeControl)).data;
      }
    } catch (error) { failure = error; }
    try {
      if (!sessionClosed && session) {
        sessionClosed = true;
        await session.close();
      }
    } catch (error) { failure ??= error; }
    try { await runtime.close?.(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }

  async function handle(input) {
    const parsed = parseTerminalInput(input);
    if (parsed.type === 'empty') return { kind: 'empty', text: '', sessionId: session?.id };
    if (parsed.type === 'unknown_command') return { kind: 'error', code: 'unknown_command', text: `未知命令：/${parsed.name}`, sessionId: session?.id };
    if (parsed.type === 'message') return sendMessage(parsed.text);
    if (parsed.name === 'exit') {
      if (core.runs && run?.status === 'running') {
        run = (await core.runs.pause({ requestId: idFactory('exit_pause'), runId: run.id, expectedVersion: run.version }, hostRunActor('exit_pause'), runtimeControl)).data;
      }
      await close();
      return { kind: 'exit', text: '已安全退出。', sessionId: session?.id, ...(run ? { runId: run.id, runStatus: run.status } : {}) };
    }
    if (parsed.name === 'status') {
      if (!run) return { kind: 'status', text: 'Persistent Run 未启用。', sessionId: session?.id };
      run = await core.runs.get(run.id);
      return { kind: 'status', text: `Run ${run.status}: ${run.id} (v${run.version})${run.checkpoint_id ? ` checkpoint=${run.checkpoint_id}` : ''}`, sessionId: session?.id, runId: run.id, runStatus: run.status };
    }
    if (parsed.name === 'pause' || parsed.name === 'resume' || parsed.name === 'stop') {
      if (!run) return { kind: 'error', code: 'run_unavailable', text: 'Persistent Run 未启用。', sessionId: session?.id };
      const method = core.runs[parsed.name];
      try {
        run = (await method({ requestId: idFactory(`${parsed.name}_run`), runId: run.id, expectedVersion: run.version }, hostRunActor(`${parsed.name}_run`), runtimeControl)).data;
        return { kind: 'run_control', text: `Run ${run.id}: ${run.status}`, sessionId: session?.id, runId: run.id, runStatus: run.status };
      } catch (error) {
        return { kind: 'error', code: error?.code ?? 'run_control_failed', text: `Run 控制失败：${error?.code ?? 'run_control_failed'}`, sessionId: session?.id, runId: run.id };
      }
    }
    if (parsed.name === 'checkpoint') {
      if (!run || !core.checkpoints) return { kind: 'error', code: 'run_unavailable', text: 'Persistent Run 未启用。', sessionId: session?.id };
      project = await core.workstreams.get(project.id);
      const checkpoint = (await core.checkpoints.create({
        requestId: idFactory('manual_checkpoint'), workstreamId: project.id, runId: run.id,
        runVersion: run.version, stateVersion: project.version,
        stateDigest: digestInput({ workstreamId: project.id, stateVersion: project.version, runId: run.id, runVersion: run.version, status: run.status }),
        label: 'manual'
      }, runActor('manual_checkpoint'))).data;
      run = await core.runs.get(run.id);
      return { kind: 'checkpoint', text: `Checkpoint ${checkpoint.id} 已保存。`, sessionId: session?.id, runId: run.id, checkpointId: checkpoint.id };
    }
    if (parsed.name === 'state') return { kind: 'state', text: formatState(await snapshot()), sessionId: session.id };
    if (parsed.name === 'memory') { if (!lastPlan) await planned(); return { kind: 'memory', text: formatMemory(lastPlan), sessionId: session.id }; }
    if (parsed.name === 'confirm-memory') {
      const [memoryId, versionText] = parsed.args ?? [];
      const expectedVersion = Number(versionText);
      if (!memoryId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return { kind: 'error', code: 'invalid_confirmation', text: '用法：/confirm-memory <memoryId> <version>', sessionId: session.id };
      }
      try {
        const confirmation = await core.confirmMemory({ memoryId, expectedVersion }, {
          requestId: idFactory('confirm_request'), actorType: 'user', sourceSessionId: session.id,
          sourceEventId: idFactory('confirm_event'),
          trustedConfirmation: { ref: idFactory('confirmation'), action: 'confirm_memory', memoryId, projectId: project.id, actorType: 'user' }
        });
        return { kind: 'confirmation', code: 'memory_confirmed', text: `已确认记忆 ${memoryId} v${confirmation.memory.version}`, sessionId: session.id, auditId: confirmation.auditId };
      } catch (error) {
        return { kind: 'error', code: error?.code ?? 'invalid_confirmation', text: '记忆确认失败，请检查编号和版本。', sessionId: session.id };
      }
    }
    if (core.runs && run?.status !== 'running') return { kind: 'error', code: 'run_not_running', text: '当前 Run 未运行，请先使用 /resume。', sessionId: session?.id, runId: run?.id };
    const previousSessionId = session.id;
    sessionClosed = true;
    await session.close();
    await openSession();
    const result = await sendMessage('请根据已提供的项目状态，简要说明当前进度和下一步。');
    return { ...result, kind: 'new_session', previousSessionId, sessionId: session.id };
  }

  return { start, handle, close, get closed() { return closed; } };
}
