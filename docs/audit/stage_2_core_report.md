# Stage 2 Margin Core implementation report

Status: implementation evidence recorded; no product or user-outcome claim is made.

## Implemented boundary

Stage 2 adds a runtime-independent, default-off Margin Core. Its SQLite migration is additive and checksum-bound. The new namespace contains projects, tasks, decisions, memories, events, actions, audit records, and a migration ledger; legacy tables are neither imported nor altered.

The exposed facade contains exactly four handlers: `memory_search`, `memory_propose`, `state_update`, and `action_update`. Permissions default to deny. Mutable aggregates use optimistic versions. Domain writes, events, and success audits share a transaction. Sensitive or durable preference candidates remain proposed, while external-write and high-risk actions require an explicit confirmation reference before proceeding.

Search is deterministic and project-scoped. It only returns confirmed, current, non-expired records, does not reinforce recalled records, and returns an explicit `no_relevant_memory` empty result.

## Evidence

- Focused contract, schema, repository, memory, state, action, composition, and documentation tests live under `test/marginCore*.test.js` and `test/stage2Documentation.test.js`.
- Migration tests cover idempotence, checksum/name drift, foreign keys, active-task uniqueness, and coexistence with a legacy table.
- Repository tests cover version conflicts, cross-project references, and injected transactional rollback.
- Stage 1 fixture integrity remains governed by its existing manifest validator.

## Explicit exclusions

The following are not implemented or claimed by Stage 2:

- Pi adapter or production Pi tool registration;
- legacy migration or automatic import of existing user data;
- a frozen 50-task evaluation set;
- A/B/C evaluation against native Pi and ordinary summaries;
- user research or continuous-use validation.

These exclusions are later-stage work and must not be represented as completed evidence.
