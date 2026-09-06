import path from 'node:path';

const refs = op => [op.id];
const shortCommand = cmd => {
  const first = cmd.split(/\r?\n/)[0];
  return first.length > 180 ? first.slice(0, 177) + '...' : first;
};
const diagnostic = value => {
  const lines = String(value?.output || '').split(/\r?\n/);
  return (lines.find(l => /(?:fatal:|^Error:|^npm error code)/i.test(l))
    || lines.find(l => /(?:EPERM|Permission denied|Access .*denied)/i.test(l)))?.trim();
};

// Goal must track the currently valid objective, not a transcript of every past request.
// Newer explicit requirements supersede older ones. A short trailing message alone (e.g. a
// bare "continue"/"完成剩余的工作") can't stand as a self-contained goal, so when the latest
// requirement is too short to be read on its own, the prior requirement is carried forward
// with it instead of guessing which older requirements are still relevant.
const GOAL_MIN_CHARS = 40;
function selectGoal(requirements) {
  if (!requirements.length) return [];
  const last = requirements[requirements.length - 1];
  const recent = last.text.trim().length >= GOAL_MIN_CHARS ? [last] : requirements.slice(-2);
  return recent.map(r => ({ confidence: 'Inferred', text: r.text, evidence: [r.id],
    basis: 'Goal inferred from the most recent explicit user request(s); superseded earlier requirements are dropped' }));
}

// A next step is deliberately narrower than a general assistant narrative. These
// patterns cover the explicit implementation/handoff phrasing seen in terminal
// session conclusions, without promoting activity reports such as "I'm checking
// X" or retrospective claims such as "tests passed".
const ACTION_START = /^(?:implement|research(?!\s+complete\b)|modify|add|update|fix|validate|run\s+(?:focused\s+)?(?:tests?|validation)|hand\s+(?:this\s+)?implementation\b)/i;
// These are intentionally narrow, observed handoff-section labels. They let a
// terminal commitment outrank implementation substeps in the same claim without
// treating arbitrary late action phrases as a handoff.
const HANDOFF_SECTION = /^(?:#{1,6}\s*)?(?:\d+[.)]\s+)?(?:implementation\s+handoff|next\s+step|recommended\s+implementation|terminal\s+(?:conclusion|handoff))\s*:?\s*$/i;

function actionFromSentence(sentence) {
  const text = sentence.trim().replace(/^[-*]\s*/, '');
  if (!text) return null;
  // A later "do not implement … yet; research … first" is a replacement
  // commitment. Keep only its actionable replacement, not the rejected action.
  const superseding = text.match(/\b(?:do not|don't)\s+implement\b[\s\S]*?\b(?:yet|instead)\s*[;,:-]\s*((?:research|investigate|validate|run)\b[\s\S]*)/i);
  if (superseding) return superseding[1].trim().replace(/[.。]\s*$/, '');
  const labelled = text.match(/(?:\bnext\s+step\s*(?:is|:)|\bimplementation\s+handoff\s*:)\s*(?:to\s+)?([\s\S]+)/i);
  if (labelled && ACTION_START.test(labelled[1].trim())) return labelled[1].trim().replace(/[.。]\s*$/, '');
  if (ACTION_START.test(text)) return text.replace(/[.。]\s*$/, '');
  const future = text.match(/^(?:i(?:\s+will|'ll)|we(?:\s+will|'ll))\s+((?:implement|research|modify|add|update|fix|validate|run\s+(?:focused\s+)?(?:tests?|validation))\b[\s\S]*)/i);
  return future ? future[1].trim().replace(/[.。]\s*$/, '') : null;
}

function actionFromHandoffSection(text) {
  const lines = text.split(/\r?\n+/);
  // Later explicit handoff sections are terminal refinements of earlier
  // recommendations; scan structural labels in reverse, not action phrases.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!HANDOFF_SECTION.test(lines[index].trim())) continue;
    // A labelled section is an explicit hierarchy boundary. Take its first
    // actionable sentence, stopping at the next Markdown heading so a later
    // unrelated section cannot be pulled into this handoff.
    for (let following = index + 1; following < lines.length; following += 1) {
      if (/^\s*#{1,6}\s+\S/.test(lines[following])) break;
      const action = lines[following]
        .split(/(?<=[.!?。！？])\s+/)
        .map(actionFromSentence)
        .find(Boolean);
      if (action) return action;
    }
  }
  return null;
}

function selectNextAction(claims) {
  let latestAction = null;
  for (const claim of claims) {
    const sentences = claim.text.split(/(?<=[.!?。！？])\s+|\r?\n+/);
    // Within one claim, an explicit handoff section wins over body/substep
    // language. Without that structural signal, retain the established first
    // explicit candidate fallback. Claims are still processed in transcript
    // order below, preserving cross-claim recency/supersession.
    const action = actionFromHandoffSection(claim.text) ?? sentences.map(actionFromSentence).find(Boolean);
    if (!action) continue;
    const candidate = { confidence: 'Inferred', text: action, evidence: [claim.id],
      basis: 'Next action inferred from the latest explicit assistant implementation/handoff commitment' };
    // Evidence nodes preserve transcript order. Replacing this candidate on each
    // explicit action gives later handoffs (including a "do not …; research …"
    // correction) ordinary supersession semantics without treating interim
    // status commentary as an action.
    latestAction = candidate;
  }
  return latestAction;
}

const COMPLETION_REPORT = /\b(?:research|implementation|phase\s*\d+(?:\s+\w+)*|poc|work|changes?|requested changes?|all requested changes?)\s+(?:is\s+)?(?:complete|completed|done)\b|(?:研究|实现|开发|修改|工作|PoC|阶段).{0,24}(?:已完成|完成了|完成)|(?:全部|所有).{0,16}(?:已完成|完成)/i;
const COMPLETION_NEGATION = /\b(?:not|isn't|is not|aren't|are not)\s+(?:yet\s+)?(?:complete|completed|done)\b|(?:regression|issue).{0,48}\b(?:remains|remaining)\b|(?:尚未|并未|没有).{0,16}(?:完成|实现)|(?:回归|问题).{0,32}(?:仍然|尚存)/i;
const RESEARCH_SUFFICIENT = /(?:research\s+stop\s+verdict\s*[:：]?\s*)?(?:stop\s*[-—:：]\s*)?enough\s+evidence\s+to\s+implement|(?:研究|调研).{0,24}(?:证据充分|足以实现|可以实现)/i;

function reportSentence(text) {
  return text.split(/(?<=[.!?。！？])\s+|\r?\n+/)
    .map(sentence => sentence.trim().replace(/^[-*]\s*/, ''))
    .find(sentence => COMPLETION_REPORT.test(sentence) && !COMPLETION_NEGATION.test(sentence));
}

// Progress is deliberately a record of source-backed milestones, never a task
// completion decision. A later explicit terminal negation invalidates an older
// assistant report, while operation/test evidence retains its own chronology.
function selectReportedMilestone(claims) {
  let milestone = null;
  for (const claim of claims) {
    if (COMPLETION_NEGATION.test(claim.text)) milestone = null;
    const sentence = reportSentence(claim.text) ?? claim.text.split(/\r?\n+/).map(line => line.trim()).find(line => RESEARCH_SUFFICIENT.test(line));
    if (sentence) milestone = { confidence: 'Inferred', temporalScope: 'historical',
      kind: 'assistant-report', text: `${RESEARCH_SUFFICIENT.test(sentence) ? 'Assistant-reported research milestone' : 'Assistant-reported milestone'}: ${sentence}`,
      evidence: [claim.id], basis: 'Assistant completion report; not independent proof that a task, feature, or slice is complete' };
  }
  return milestone;
}

function progressFromEvidence(evidence, truth, latest) {
  const progress = [];
  const operationKey = operation => JSON.stringify([operation.command, operation.cwd]);
  const claims = evidence.nodes.filter(n => n.kind === 'Assistant claim');
  const report = selectReportedMilestone(claims);
  if (report) progress.push(report);

  // Count every historical successful test execution: repeated focused runs are
  // meaningful validation evidence. A failure is different: omit it only when
  // a later execution of that exact command explicitly succeeded.
  const allTestOps = evidence.operations.filter(o => o.kinds?.test);
  const testOps = [...latest.values()].filter(o => o.kinds?.test);
  const passed = allTestOps.filter(o => o.status === 'succeeded');
  const failed = allTestOps.filter(o => o.status === 'failed' && latest.get(operationKey(o)) === o);
  const unknown = testOps.filter(o => !['succeeded', 'failed'].includes(o.status));
  if (passed.length) progress.push({ confidence: 'Confirmed', temporalScope: 'historical', kind: 'historical-validation',
    text: `Historical validation: ${passed.length} focused test command${passed.length === 1 ? '' : 's'} exited 0.`,
    evidence: passed.map(o => o.id), basis: 'Historical process exit results; this is not a current validation run' });
  if (failed.length) progress.push({ confidence: 'Confirmed', temporalScope: 'historical', kind: 'historical-validation',
    text: `Historical validation: ${failed.length} focused test command${failed.length === 1 ? '' : 's'} failed.`,
    evidence: failed.map(o => o.id), basis: 'Historical non-zero process exit results; later assistant reports do not erase this evidence' });
  if (!testOps.length || unknown.length) progress.push({ confidence: 'Uncertain', temporalScope: 'historical', kind: 'historical-validation',
    text: !testOps.length ? 'Historical validation: unknown; no direct test result was recovered from the frozen Session.'
      : `Historical validation: ${unknown.length} focused test command${unknown.length === 1 ? '' : 's'} had no explicit final result.`,
    evidence: !testOps.length ? ['coverage:source'] : unknown.map(o => o.id), basis: 'No explicit historical test outcome is available for these commands' });

  const edits = evidence.operations.filter(o => o.edits?.length);
  const editSucceeded = edits.filter(o => o.status === 'succeeded');
  const editUnknown = edits.filter(o => !['succeeded', 'failed'].includes(o.status));
  const editFailed = edits.filter(o => o.status === 'failed');
  if (editSucceeded.length) progress.push({ confidence: 'Confirmed', temporalScope: 'historical', kind: 'structured-work',
    text: `Structured work evidence: ${editSucceeded.length} edit operation${editSucceeded.length === 1 ? '' : 's'} explicitly succeeded historically.`,
    evidence: editSucceeded.map(o => o.id), basis: 'Explicit operation result for statically extracted edit targets' });
  if (editUnknown.length) progress.push({ confidence: 'Uncertain', temporalScope: 'historical', kind: 'structured-work',
    text: `Structured work evidence: ${editUnknown.length} edit operation${editUnknown.length === 1 ? '' : 's'} had no explicit historical result.`,
    evidence: editUnknown.map(o => o.id), basis: 'Structured edit target was extracted, but its operation outcome is unknown' });
  if (editFailed.length) progress.push({ confidence: 'Confirmed', temporalScope: 'historical', kind: 'structured-work',
    text: `Structured work evidence: ${editFailed.length} edit operation${editFailed.length === 1 ? '' : 's'} failed historically.`,
    evidence: editFailed.map(o => o.id), basis: 'Explicit failed operation result for a statically extracted edit target' });

  const targets = truth.files?.filter(file => file.targetProvenance?.length) ?? [];
  if (targets.length) {
    const present = targets.filter(file => file.status === 'exists');
    progress.push({ confidence: targets.every(file => file.confidence === 'Confirmed') ? 'Confirmed' : 'Uncertain', temporalScope: 'current', kind: 'current-corroboration',
      text: `Current repo corroboration: ${present.length}/${targets.length} structured historical target${targets.length === 1 ? '' : 's'} currently exist${present.length === targets.length ? '' : '; inspect Current Applicability for details'}.`,
      evidence: targets.flatMap(file => [file.id, ...file.targetProvenance.map(target => target.operationId)]),
      basis: 'Current repo observation only; it does not establish historical edit success or current validation' });
  }
  progress.push({ confidence: 'Uncertain', temporalScope: 'current', kind: 'current-validation',
    text: 'Current validation: unknown; historical tests have not been rerun against the current repository observation.',
    evidence: ['repo:git'], basis: 'No current test-rerun evidence is collected by this handoff' });
  return progress;
}

export function distill(evidence, truth) {
  const requirements = evidence.nodes.filter(n => n.kind === 'User requirement');
  const claims = evidence.nodes.filter(n => n.kind === 'Assistant claim');
  const state = { schemaVersion: 'margin.distilled-state.v1', source: evidence.source,
    generatedAt: new Date().toISOString(), repoTruthAt: truth.capturedAt,
    scope: 'Historical Session checkpoint reconciled with present Workspace; no automatic task completion inference',
    goal: selectGoal(requirements),
    currentState: [], completed: [], failed: [], openIssues: [], changedFiles: [], tests: [], progress: [], nextStep: [] };
  const git = truth.git;
  state.currentState.push({ confidence: git.status === 'available' && truth.stableDuringObservation ? 'Confirmed' : 'Uncertain',
    text: git.status === 'available' ? `当前仓库 ${truth.workspace}；branch=${git.branch ?? '(detached)'}；HEAD=${git.head}；${git.changes.length} 个已跟踪修改/未跟踪文件。`
      : `当前 Git 事实不可读取：${git.errorCode}`, evidence: ['repo:git'] });
  if (!truth.stableDuringObservation) state.openIssues.push({ confidence: 'Uncertain',
    text: '仓库在读取期间变化；此快照不保证一致，接手前重新刷新。', evidence: ['repo:git'] });
  const shell = evidence.operations.filter(o => o.command);
  const key = o => JSON.stringify([o.command, o.cwd]);
  const latest = new Map(shell.map(o => [key(o), o]));
  for (const op of shell.filter(o => o.status === 'failed')) {
    const retry = latest.get(key(op));
    state.failed.push({ confidence: 'Confirmed', operationId: op.id,
      text: `命令进程失败：${shortCommand(op.command)}；${diagnostic(op.value) || op.reason}`,
      resolvedBy: retry !== op && retry.status === 'succeeded' ? retry.id : null,
      evidence: [...refs(op), ...(retry !== op && retry.status === 'succeeded' ? refs(retry) : [])] });
  }
  for (const op of shell.filter(o => o.status === 'succeeded' && (/^git clone\b/.test(o.command)
    || /^(npm(?:\.cmd)?|pnpm)\s+(install|ci)\b/.test(o.command) || o.kinds?.test))) {
    state.completed.push({ confidence: 'Confirmed', text: `历史命令进程已成功返回：${shortCommand(op.command)}（${op.reason}）；不代表之后文件仍未变化。`,
      evidence: refs(op) });
  }
  const editedPaths = [...new Set(truth.patchChecks.map(p => p.path).filter(Boolean))];
  for (const file of truth.files.filter(f => editedPaths.includes(f.path))) {
    const checks = truth.patchChecks.filter(p => p.path === file.path);
    const last = checks.at(-1);
    const present = file.status === 'exists';
    state.changedFiles.push({ confidence: file.confidence, path: file.path, sha256: file.sha256,
      observedState: file.status, historicalEditStatus: evidence.operations.find(o => o.id === last.operationId)?.status,
      contentCheck: last.meaning, evidence: [file.id, ...checks.map(c => c.operationId)] });
    if (present && file.confidence === 'Confirmed') state.completed.push({ confidence: 'Confirmed',
      text: `文件当前已存在：${path.relative(truth.workspace, file.path)}；${last.exactAdd ? '与新增内容一致' : last.additionsPresent ? '最近补丁添加行仍存在，未证明完整历史应用结果' : '内容已变化或无法验证历史补丁'}。先检查现状，避免直接重复创建。`,
      evidence: [file.id, last.operationId] });
    if (!present) state.openIssues.push({ confidence: 'Uncertain', text: `历史修改目标当前为 ${file.status}：${file.path}；无法确认完成或是否后来删除。`,
      evidence: [file.id, last.operationId] });
  }
  for (const report of truth.artifactReports) {
    const file = truth.files.find(f => f.id === report.fileEvidenceId);
    if (file?.status === 'exists') state.currentState.push({ confidence: file.confidence, text: `产物当前存在：${file.path}（${file.bytes} bytes）。`, evidence: [file.id] });
    if (report.reportedPasses !== undefined) state.tests.push({ confidence: 'Inferred',
      text: `已有报告记载 ${report.reportedPasses} 项通过，时间 ${report.reportedAt}；源快照哈希${report.sourceHashMatches ? '匹配' : '不匹配'}。这不是对当前代码的新测试。`, evidence: [file?.id].filter(Boolean) });
  }
  const testOps = [...latest.values()].filter(o => o.kinds?.test);
  for (const op of testOps) state.tests.push({ confidence: op.confidence, status: op.status,
    text: `测试命令 ${shortCommand(op.command)}：${op.status}；${op.reason}。`, evidence: refs(op) });
  if (!testOps.length) state.tests.push({ confidence: 'Uncertain', text: '冻结 Session 未识别到直接测试执行/结果，不能声称测试已通过。', evidence: ['coverage:source'] });
  state.progress = progressFromEvidence(evidence, truth, latest);
  for (const claim of claims.filter(c => /(?:all tests passed|所有测试.*通过|测试全部通过)/i.test(c.text))) {
    const failedTests = testOps.filter(o => o.status === 'failed');
    if (failedTests.length) state.openIssues.push({ confidence: 'Uncertain', text: 'Assistant 声称测试全通过，但最新测试进程证据存在失败；以失败事实为准，成功自述不进入 Completed。',
      evidence: [claim.id, ...failedTests.map(o => o.id)] });
  }
  for (const claim of claims.filter(c => /(?:已创建|创建成功|已完成|created|completed)/i.test(c.text))) {
    for (const file of truth.files.filter(f => f.status === 'missing' && claim.text.includes(path.basename(f.path)))) {
      state.openIssues.push({ confidence: 'Uncertain', text: `Assistant 声称完成的文件当前缺失：${file.path}；可能未成功或后来删除，不能由自述确认。`,
        evidence: [claim.id, file.id] });
    }
  }
  const unresolved = evidence.operations.filter(o => ['unknown', 'running'].includes(o.status)
    && !(o.name === 'write_stdin' && evidence.operations.some(root => root.initialOutcome?.value?.session_id === o.args?.session_id
      && ['succeeded', 'failed'].includes(root.status))));
  const missingResults = evidence.nodes.filter(n => n.kind === 'Tool call' && !n.resultIds.length);
  if (missingResults.length) state.openIssues.push({ confidence: 'Uncertain', text: `${missingResults.length} 个外层调用在捕获边界没有返回；未知是否完成，不能直接重试可能写入的操作。`, evidence: missingResults.map(n => n.id) });
  if (unresolved.length) state.openIssues.push({ confidence: 'Uncertain',
    text: `${unresolved.length} 个内部操作在捕获证据中没有明确终态（含空补丁返回、裁剪）；这不是当前阻塞清单。已存在文件只能证明当前存在，不能倒推历史命令成功。`, evidence: unresolved.map(o => o.id) });
  // Decisions: no automatic inference from execution facts. Without reliable decision evidence,
  // the field is omitted entirely rather than filled with a placeholder — handoff.js only
  // renders a Decisions section when state.decisions is present and non-empty.
  const recoveredNextAction = selectNextAction(claims);
  state.nextStep.push(recoveredNextAction ?? { confidence: 'Inferred', text: '先阅读已存在产物与当前相关文件，核对未返回调用及报告时间；仅执行确实缺失的下一步。复用经核对仍有效的文件与依赖，不直接重建或重装；不因旧 Session 的空待办数组就宣布任务完成。',
    evidence: [...state.currentState.flatMap(s => s.evidence), ...missingResults.map(n => n.id)] });
  return state;
}
