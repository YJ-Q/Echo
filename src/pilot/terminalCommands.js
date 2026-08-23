const COMMANDS = new Set(['state', 'status', 'memory', 'new', 'exit', 'confirm-memory', 'pause', 'resume', 'stop', 'checkpoint']);

export function parseTerminalInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return { type: 'empty' };
  if (!text.startsWith('/')) return { type: 'message', text };
  const [name, ...args] = text.slice(1).trim().toLowerCase().split(/\s+/);
  return COMMANDS.has(name)
    ? { type: 'command', name, ...(args.length ? { args } : {}) }
    : { type: 'unknown_command', name };
}

const value = (input) => input === undefined || input === null || input === '' ? '-' : String(input);
const version = (record) => `v${value(record?.version ?? record?.entityVersion)}`;

export function formatState(snapshot = {}) {
  const project = snapshot.project;
  const tasks = (snapshot.tasks ?? (snapshot.task ? [snapshot.task] : [])).slice(0, 10);
  const actions = (snapshot.actions ?? []).slice(0, 10);
  const lines = [
    `项目: ${value(project?.goal)} [${value(project?.id)} ${version(project)}]`,
    `阶段: ${value(project?.phase)} / ${value(project?.status)}`,
    '任务:'
  ];
  lines.push(...(tasks.length ? tasks.map((item) =>
    `- ${value(item.title)}；当前：${value(item.current_step ?? item.currentStep)}；阻塞：${value(item.blocker)} [${value(item.id)} ${version(item)}]`
  ) : ['- 无']));
  lines.push('行动:');
  lines.push(...(actions.length ? actions.map((item) =>
    `- ${value(item.title)}；状态：${value(item.status)}；期限：${value(item.due_at ?? item.dueAt)} [${value(item.id)} ${version(item)}]`
  ) : ['- 无']));
  return lines.join('\n');
}

export function formatMemory(plan = {}) {
  const memories = (plan.selected ?? []).filter((item) => item.entityType === 'memory').slice(0, 10);
  if (!memories.length) return '未召回相关内容';
  return memories.map((item) =>
    `- ${value(item.content)} [${value(item.entityId)} ${version(item)}] 来源Session=${value(item.sourceSessionId)} 原因=${value(item.reason)} 确认=${value(item.confirmationStatus ?? 'confirmed')}`
  ).join('\n');
}
