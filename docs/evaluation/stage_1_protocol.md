# Margin Stage 1 Frozen Evaluation Protocol

Protocol version: `1.0.0`. Frozen: 2026-08-20.

## Product question

After a sustained task is interrupted, can a user enter a new Session, repeat less background, recover the latest valid state, and complete the specified next-step artifact safely?

This protocol covers exactly `learning_research` and `career_project`. A recap or plan without the required artifact is not success.

## Success contract

A run passes only if it selects the correct project, recovers every required current fact without a forbidden fact, avoids unnecessary background questions, exposes source identifiers, completes every artifact check, and remains within the fixture's tool and confirmation permissions. No relevant memory must produce an explicit empty result rather than a memory claim.

Artifact checks are deterministic requirements attached to the task, such as citing a current fact, excluding a stale value, producing a specified document fragment, or stopping at a confirmation boundary. Structural fixture validation does not score model output.

## Failure labels

- `missing_required_context`
- `incorrect_recovery`
- `stale_state_override`
- `cross_project_contamination`
- `unnecessary_background_request`
- `unsupported_memory_claim`
- `unauthorized_tool_attempt`
- `recap_without_progress`
- `intrusive_recall`

## Fixture fields

Each fixture declares an immutable task and protocol ID, scenario, synthetic project, prior Session and interruption point, source/version-addressable current facts, distractors, new-Session request, required and forbidden fact IDs, artifact type and checks, tool allowlist, confirmation boundary, clarification rule, expected failure labels, and covered risks.

`synthetic` must be true, `containsRealPersonalData` must be false, and `durableStateQualified` must be true. A prior Session whose kind is ordinary chat is invalid. Only `memory_search`, `memory_propose`, `state_update`, and `action_update` may appear in permissions.

## Immutability

`evaluation/stage1/manifest.json` binds the ordered task IDs and exact fixture bytes with SHA-256. Any edit invalidates the set until a deliberate protocol/version decision creates new evidence. Frozen fixtures must not be rewritten to improve a later score.

## Architecture boundary

Margin Core owns authoritative State/Memory and audit semantics. The Pi Extension Adapter exposes the four tools and runtime events without reimplementing Pi. A scenario Skill Policy guides workflow but does not own state, permissions, or scoring.

## Claim boundary

All content is synthetic and is not user validation. Passing the validator means only that fixtures satisfy the frozen structural contract and match the manifest. It is not task success, a baseline result, market evidence, production Pi integration, or proof that users repeat less background.
