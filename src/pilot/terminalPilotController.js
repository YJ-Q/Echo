import { digestInput } from '../core/contracts.js';
import { formatMemory, formatState, parseTerminalInput } from './terminalCommands.js';

const GOAL = '持续完成简历投递并维护投递记录';
const CONTINUE_QUERY = '继续简历投递和投递记录维护';

function evidence(idFactory, sessionId, operation, input) {
  return {
    requestId: idFactory('request'), actorType: 'user', sourceSessionId: sessionId,
    sourceEventId: idFactory('event'), inputDigest: digestInput(input),
    permissionDecision: 'allowed', operation
  };
}

function classify(error) {
  return error?.code === 'PI_MODEL_UNAVAILABLE' || String(error?.code).startsWith('PI_')
    ? 'provider_unavailable'
    : 'pilot_failure';
}

export function createTerminalPilotController({ core, runtime, registry, clock, idFactory }) {
  if (!core?.store || !core?.tools || !runtime?.createSession || !registry || !clock || !idFactory) {
    throw new TypeError('invalid_terminal_pilot_dependencies');
  }
  let project;
  let session;
  let lastPlan;
  let closed = false;
  let sessionClosed = false;

  async function openSession() {
    session = await runtime.createSession({
      tools: core.tools,
      getInvocationContext: async ({ toolCallId }) => ({
        actorType: 'agent',
        permissions: { memoryRead: true, memoryWrite: true, stateWrite: true, actionWrite: true },
        confirmations: [], sourceSessionId: session?.id, sourceEventId: toolCallId,
        projectId: project?.id
      })
    });
    sessionClosed = false;
    if (!session?.id || !session?.send || !session?.close) throw new TypeError('invalid_pilot_session');
    return session;
  }

  async function snapshot(query = CONTINUE_QUERY) {
    const base = await core.store.getContinuitySnapshot({ projectId: project.id, query, asOf: clock(), recentDialogue: [] });
    const actions = core.store.db?.all
      ? await core.store.db.all("SELECT * FROM margin_actions WHERE project_id = ? AND status IN ('pending','active') ORDER BY updated_at DESC LIMIT 10", project.id)
      : [];
    return { ...base, task: base.activeTask, tasks: base.activeTask ? [base.activeTask] : [], actions };
  }

  async function planned(query = CONTINUE_QUERY) {
    const current = await snapshot(query);
    const basePlan = await core.planContext({ projectId: project.id, query, asOf: clock(), recentDialogue: [] });
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
    project = savedId ? await core.store.getProject(savedId) : null;
    if (!project || project.status !== 'active') {
      project = await core.store.findActiveProjectByScenario?.('career_project') ?? null;
      if (project) await registry.save(project.id);
    }
    await openSession();
    if (!project || project.status !== 'active') {
      const input = { scenario: 'career_project', goal: GOAL, phase: 'pilot', status: 'active' };
      project = await core.store.createProject(input, evidence(idFactory, session.id, 'create_project', input));
      const task = { projectId: project.id, title: '推进简历投递', currentStep: '记录下一次投递', blocker: null, completionCondition: '投递记录已更新', status: 'active' };
      await core.store.createTask(task, evidence(idFactory, session.id, 'create_task', task));
      await registry.save(project.id);
    }
    return { projectId: project.id, sessionId: session.id };
  }

  async function sendMessage(message) {
    try {
      const { plan } = await planned(message);
      const response = await session.send({ context: plan, message });
      const confirmations = (response?.toolResults ?? []).map((item) =>
        `[工具 ${item.toolName}: ${item.code}${item.auditId ? ` audit=${item.auditId}` : ''}]`
      );
      return {
        kind: 'message', text: [response?.text ?? '', ...confirmations].filter(Boolean).join('\n'), sessionId: session.id,
        trace: { sessionId: session.id, projectId: project.id, contextDigest: plan.digest, resultCodes: response?.resultCodes ?? [] }
      };
    } catch (error) {
      const code = classify(error);
      return { kind: 'error', code, text: code === 'provider_unavailable' ? '模型暂时不可用，请稍后重试。' : '试点操作失败，请重试。', sessionId: session?.id };
    }
  }

  async function close() {
    if (!sessionClosed && session) {
      sessionClosed = true;
      await session.close();
    }
    closed = true;
    await runtime.close?.();
  }

  async function handle(input) {
    const parsed = parseTerminalInput(input);
    if (parsed.type === 'empty') return { kind: 'empty', text: '', sessionId: session?.id };
    if (parsed.type === 'unknown_command') return { kind: 'error', code: 'unknown_command', text: `未知命令：/${parsed.name}`, sessionId: session?.id };
    if (parsed.type === 'message') return sendMessage(parsed.text);
    if (parsed.name === 'exit') { await close(); return { kind: 'exit', text: '已安全退出。', sessionId: session?.id }; }
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
    const previousSessionId = session.id;
    sessionClosed = true;
    await session.close();
    await openSession();
    const result = await sendMessage('请根据已提供的项目状态，简要说明当前进度和下一步。');
    return { ...result, kind: 'new_session', previousSessionId, sessionId: session.id };
  }

  return { start, handle, close, get closed() { return closed; } };
}
