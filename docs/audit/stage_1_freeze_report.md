# Margin Stage 1 Evaluation Freeze Report

Freeze date: 2026-08-20. Protocol: `1.0.0`.

## Outcome

Stage 1 now has a machine-validated synthetic seed set for `learning_research` and `career_project`. Each scenario contains five representative tasks. Every task requires a continuation artifact or an explicit safe boundary; `recap_without_progress` remains a failure.

This freeze is not user validation and is not evidence of improved task performance. It establishes only that the evaluation inputs and structural rules are reproducible.

## Architecture boundary

- Margin Core will own authoritative State/Memory, sources, versions, correction/deletion history, gates, permissions, and audit evidence.
- The Pi Extension Adapter will expose Margin tools and lifecycle integration without claiming Pi's Session, branching, tool loop, or compaction as Margin work.
- A learning/research or career/project Skill Policy will guide scenario behavior but will not own authoritative state or scoring.

## Frozen tasks

Learning and research:

- `lr-new-session-001`
- `lr-no-memory-004`
- `lr-project-switch-003`
- `lr-sensitive-note-005`
- `lr-stale-source-002`

Career and project advancement:

- `cp-casual-chat-005`
- `cp-decision-override-002`
- `cp-project-switch-003`
- `cp-resume-version-001`
- `cp-tool-confirmation-004`

The manifest binds each task ID, relative path, and exact file bytes with SHA-256. Changes require an explicit protocol decision; fixtures must not be edited to accommodate later implementation behavior.

## Covered risks

The seed set exercises missing context, incorrect recovery, stale-state override, cross-project contamination, unnecessary repetition, unsupported memory claims, unauthorized tool attempts, recap without progress, and intrusive recall. It includes explicit empty-memory behavior, a confirmation boundary, a casual-chat distractor, and a sensitive irrelevant distractor.

## Verification

Run under the pinned Node runtime:

```powershell
$env:Path = "$PWD\.runtime\node-v22.23.1-win-x64;$env:Path"
npm test
npm run validate:stage1
npm run audit:pi
```

The validator checks protocol version, field invariants, synthetic-data markers, allowed tools, scenario balance, artifact diversity, risk coverage, manifest hashes, and credential patterns. Passing it is structural readiness, not task success.

## Remaining work

A/B/C baselines have not been run. Stage 1 does not implement production State/Memory, the four production tools, the production Pi chat path, or real-user research. No task success, recovery time, memory precision, memory recall, cost, adoption, or user outcome result is claimed here.
