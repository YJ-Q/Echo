// Smart Handoff: minimum sufficient state for a new Coding Agent to continue.
// Sections with no evidence are omitted entirely.
export function renderSmartHandoff(state, truth) {
  const lines = ['# Margin Smart Handoff', '',
    `源 checkpoint：${state.source?.capturedAt ?? 'unknown'}；Repo Truth：${state.repoTruthAt}。`,
    'Confirmed = 句子描述的事实。Inferred = 解释/意图。Uncertain = 未能确认，不代表失败。', ''];
  const section = (title, items, renderItem) => {
    if (!items.length) return;
    lines.push(`## ${title}`, '');
    for (const item of items) lines.push(renderItem(item), '');
  };
  // Goal: always include if present
  if (state.goal?.length) {
    lines.push('## 目标（历史请求，接手前请确认是否更新）', '');
    for (const g of state.goal) lines.push(`- **${g.confidence}** ${g.text}`, '');
    lines.push('');
  } else {
    lines.push('## 目标', '', '- **Uncertain** 未能从 Session 恢复目标。', '');
  }
  section('当前状态', state.currentState,
    s => `- **${s.confidence}** ${s.text}`);
  section('Progress', state.progress ?? [],
    p => `- **${p.confidence} · ${p.temporalScope === 'historical' ? 'Historical' : 'Current'}** ${p.text}`);
  section('Historical Report', state.historicalReport ?? [],
    item => `- **${item.confidence} · Historical** ${item.text}`);
  section('Historical Pending / Blockers', state.historicalPending ?? [],
    item => `- **${item.confidence} · Historical** ${item.text}`);
  section('Historical Recommended Follow-up', state.historicalFollowUp ?? [],
    item => `- **${item.confidence} · Historical** ${item.text}`);
  section('约束', state.constraints ?? [],
    c => `- **${c.confidence}** ${c.text}`);
  section('已完成（事实范围）', state.completed,
    c => `- **${c.confidence}** ${c.text}`);
  section('Decisions', state.decisions ?? [],
    d => `- **${d.confidence}** ${d.text}`);
  section('失败 / 已拒绝', state.failed.filter(f => !f.resolvedBy),
    f => `- **${f.confidence}** ${f.text}`);
  const resolvedFails = state.failed.filter(f => f.resolvedBy);
  if (resolvedFails.length) {
    lines.push('## 失败后重试成功', '');
    for (const f of resolvedFails) lines.push(`- **Confirmed** ${f.text}；后续同命令成功：${f.resolvedBy}`, '');
    lines.push('');
  }
  section('Open Issues', state.openIssues,
    i => `- **${i.confidence}** ${i.text}`);
  section('测试', state.tests,
    t => `- **${t.confidence}** ${t.text}`);
  if (state.changedFiles?.length) {
    lines.push('## 改动文件', '');
    for (const f of state.changedFiles) {
      const rel = f.path.replace(truth.workspace, '').replace(/^[\\/]/, '') || f.path;
      lines.push(`- **${f.confidence}** \`${rel}\`：当前 ${f.observedState}；${f.contentCheck}`, '');
    }
  }
  // `nextStep` is recovered from an old assistant claim.  It is historical
  // session intent, not a conclusion that the same action is currently
  // executable.  Keep the compact internal state shape, but make that boundary
  // explicit in the user-facing handoff.
  const historicalIntent = (state.nextStep ?? []).filter(item =>
    item.basis === 'Next action inferred from the latest explicit assistant implementation/handoff commitment');
  const genericRecommendations = (state.nextStep ?? []).filter(item => !historicalIntent.includes(item));
  section('Historical Intent', historicalIntent,
    intent => `- **${intent.confidence}** ${intent.text}`);

  if (historicalIntent.length) {
    lines.push('## Current Applicability', '');
    if (truth.targetLinkage?.status !== 'available') {
      lines.push('- **Unknown** No structured repo targets are available for reconciliation.', '');
    } else {
      lines.push('- Structured historical targets currently observed in the repo:', '');
      const targets = (truth.files ?? []).filter(file => file.targetProvenance?.length);
      for (const file of targets) {
        const rel = file.path.replace(truth.workspace, '').replace(/^[\\/]/, '') || file.path;
        const operations = [...new Set(file.targetProvenance.map(target => target.operationId))].join(', ');
        const observation = file.status === 'exists'
          ? `exists; ${file.bytes} bytes; SHA-256 ${file.sha256}; observed ${file.modifiedAt}`
          : `currently ${file.status}`;
        lines.push(`  - ${operations} → \`${rel}\` — ${observation}`);
      }
      // A linkage can be available even if an observation could not be retained
      // (for example, an invalid target path). State that limited fact without
      // inventing an action-level result.
      if (!targets.length) lines.push('- Structured target linkage is available, but no current file observation was retained.');
      lines.push('');
    }
  }
  // The old generic fallback remains useful when no explicit historical action
  // was recovered, but it is deliberately not presented as either historical
  // intent or a repo-reconciled current action.
  section('接手建议（非当前动作结论）', genericRecommendations,
    n => `- **${n.confidence}** ${n.text}`);
  lines.push('## Evidence Pointers', '',
    `- 快照：${state.source?.snapshotPath ?? 'unknown'}`,
    `- SHA-256：${state.source?.sha256 ?? 'unknown'}`,
    `- Workspace：${truth.workspace}`,
    '- call:L<n>/op<m> 指向 evidence 的 operations；file:* / repo:git 指向 repo-truth。',
    '- 接手时读证据而非直接执行历史代码片段。', '');
  return lines.join('\n');
}
