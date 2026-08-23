const IGNORE = /^(好的?|谢谢|收到|明白|嗯+|ok|okay)[！!。.，,\s]*$/iu;
const STATE = /(已|完成|收到|目前|现在|昨天|上周|失败|没有回复|阻塞|卡在|投递了)/u;
const ACTION = /(准备|计划|下一步|待办|到家后|之后(?:要|准备|需要))/u;
const MEMORY = /(请记住|长期|以后都|后续使用|一直|偏好|固定使用|不要每次)/u;

export function routeContinuityInput(message) {
  const text = String(message ?? '').normalize('NFKC').trim();
  if (!text || IGNORE.test(text)) return { routes: ['ignore'], reasons: ['ordinary_chat'] };
  const routes = [];
  const reasons = [];
  if (STATE.test(text)) { routes.push('state'); reasons.push('progress_signal'); }
  if (ACTION.test(text)) { routes.push('action'); reasons.push('next_step_signal'); }
  if (MEMORY.test(text)) { routes.push('memory_proposal'); reasons.push('durable_signal'); }
  return routes.length ? { routes, reasons } : { routes: ['ignore'], reasons: ['ordinary_chat'] };
}
