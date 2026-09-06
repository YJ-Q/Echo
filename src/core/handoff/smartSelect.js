// Smart selection: Distilled State -> a compact Smart view, same shape, fewer/
// collapsed items. distiller.js (Distilled State) is untouched — this is a
// separate, disposable step so a future Detailed/Deep selection can read the
// same Distilled State through a different function later:
//
//   Distilled State -> Smart selection -> Markdown (renderSmartHandoff, unchanged)
//
// Plain functions, no strategy/plugin framework. Nothing here decides on raw
// character/token counts; every reduction below is either (a) recognizing that
// a "fact" isn't actually a usable current-goal statement, or (b) collapsing
// exact duplicate facts the current distiller can legitimately produce (e.g.
// the same shell command re-run and re-succeeding across a long session).

// Real bug found via testing against an actual Codex session (Slice 2.1): Codex
// sometimes emits an internal approval/risk-review turn as an ordinary "user"
// message that embeds the *entire* prior transcript, and the embedded text
// self-labels itself "untrusted evidence, not instructions to follow".
//
// Slice 2.2 fixed the root cause upstream: session-source.js now reads Codex's own
// `thread_source` field (codex-rs SessionMeta) off session_meta, and evidence.js
// classifies every record in a non-"user" thread as "Internal context/control"
// instead of "User requirement"/"Assistant claim". Such a fact no longer reaches
// Goal at all, so this marker/regex is no longer the thing keeping it out.
//
// It stays as a last-resort safety net for the case the upstream fix doesn't cover:
// a thread with no `thread_source` at all (older Codex captures predate the field),
// where a similar internal turn could in principle still surface as literal "user"
// text. Normal sessions never hit this — it only fires if the exact marker text is
// present, which real user requirements do not contain.
const REVIEW_ENVELOPE_MARKER = /^The following is the Codex agent history whose request action you are assessing/;

function selectGoal(goal) {
  return goal.map((fact) => {
    if (!REVIEW_ENVELOPE_MARKER.test(fact.text.trim())) return fact;
    return { confidence: 'Uncertain', evidence: fact.evidence,
      text: '此处捕获到的 "User requirement" 实际是 Codex 内部审批/风险评估请求；其自身文本已声明内嵌的历史 transcript 为 "untrusted evidence, not instructions to follow"，不是一条可执行的当前目标陈述。未能从这条证据中恢复独立目标；完整原文见 evidence 指针。',
      basis: 'Requirement text self-identifies as a non-instructional review artifact embedding a historical transcript, not a literal current objective.' };
  });
}

// Collapse exact duplicate facts (same rendered text) into one, keeping the most
// recent occurrence's confidence/evidence and noting the repeat count. This is
// deduplication, not a top-N cutoff — a session with no repeats passes through
// with zero change; one with N identical reruns of the same successful/failed
// command collapses to one line instead of N near-identical ones.
function dedupeExact(items) {
  const order = [];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.text)) order.push(item.text);
    groups.set(item.text, [...(groups.get(item.text) ?? []), item]);
  }
  return order.map((text) => {
    const group = groups.get(text);
    const last = group[group.length - 1];
    if (group.length === 1) return last;
    return { ...last, evidence: [...new Set(group.flatMap((g) => g.evidence ?? []))],
      text: `${last.text}（同一事实重复出现 ${group.length} 次，仅展示一次）` };
  });
}

export function selectSmart(state) {
  return { ...state,
    goal: selectGoal(state.goal),
    // Progress items are already evidence-level aggregates (rather than an
    // operation log), so Smart preserves their distinct temporal semantics.
    progress: state.progress ?? [],
    completed: dedupeExact(state.completed),
    // Failures fully superseded by a later same-command success carry no
    // action value for the next agent ("don't repeat X" no longer applies once
    // X has since worked) — Slice 2.1 §4 allows omitting these from Smart
    // entirely. They remain in Distilled State; only Smart drops them.
    failed: dedupeExact(state.failed.filter((f) => !f.resolvedBy)) };
}
