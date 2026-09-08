import { readClaudeSessionSource } from './claudeSessionSource.js';
import { buildClaudeEvidence } from './claudeEvidence.js';
import { refreshRepoTruth } from '../../core/handoff/repo-truth.js';
import { distill } from '../../core/handoff/distiller.js';
import { selectSmart } from '../../core/handoff/smartSelect.js';
import { renderSmartHandoff } from '../../core/handoff/handoff.js';
import { projectResumeSummary } from '../../core/handoff/resume-summary.js';

// Claude handoff is a thin, agent-neutral boundary over the existing Shared Handoff Core. It
// never renders its own Markdown and never re-implements repo-truth / distill / Smart selection:
// the only Claude-specific step is extraction of native evidence, which the Shared Core then
// consumes exactly as it does for Codex and Pi.
export function generateClaudeHandoff(capture, workspace, { artifactPaths = [] } = {}) {
  const source = readClaudeSessionSource(capture);
  const evidence = buildClaudeEvidence(source);
  const truth = refreshRepoTruth(workspace, evidence, artifactPaths);
  const state = distill(evidence, truth);
  const markdown = renderSmartHandoff(selectSmart(state), truth);
  const resumeSummary = projectResumeSummary(state, truth);
  return { evidence, truth, state, markdown, resumeSummary };
}
