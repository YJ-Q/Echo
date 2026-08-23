# Margin Stage 3 Pi Adapter and Context Planner MVP Design

Status: approved design. Date: 2026-08-20.

## Objective

Stage 3 builds the smallest real cross-Session continuity loop on top of the pinned Pi runtime and the default-off Margin Core. A new Pi Session must be able to recover the current project, active task, confirmed decisions, and relevant memories created from an earlier Session, then continue the next step with less repeated background.

This stage prioritizes a usable MVP over comprehensive evaluation. It preserves the critical safety boundary and enough evidence to diagnose later usage failures, while deferring large test matrices and performance claims.

## Scope

Stage 3 includes:

- a thin internal Pi Extension Adapter for the four existing Margin Core tools;
- a runtime-independent Context Planner;
- an isolated continuity harness that exercises Session A to Session B;
- deterministic key-path tests;
- an optional YAPI-backed live smoke test using the existing environment configuration.

Stage 3 does not replace the production `/chat` route, import legacy data, alter `memoryStore`, run the frozen 50-task set, execute A/B/C evaluation, or claim user validation.

## Chosen architecture

### Margin Pi Adapter

The adapter registers exactly these tools with Pi:

- `memory_search`
- `memory_propose`
- `state_update`
- `action_update`

It translates Pi tool arguments into the stable Margin Core contract and translates the Core result envelope back into bounded Pi tool output. It does not own durable state, retrieval ranking, confirmation policy, credentials, or model selection.

The adapter obtains trusted invocation context from a host callback rather than tool text. The callback supplies actor type, permissions, source Session ID, source event ID, and trusted confirmation records. Natural-language content cannot grant permission or validate a confirmation reference.

### Context Planner

The planner has no Pi imports and performs no writes. It accepts a project snapshot, one active task, current confirmed decisions, candidate confirmed memories, recent necessary dialogue, and a bounded item budget.

It selects content in this fixed order:

1. current project state;
2. active task and blocker;
3. current confirmed decisions;
4. Top-K relevant confirmed memories;
5. recent necessary dialogue.

Every selected item carries its entity type, entity ID, version, source Session ID when available, and selection reason. Excluded items are summarized by ID and exclusion reason. Session history, Pi compaction output, and Margin long-term memory remain distinct source types.

### Continuity Harness

The harness is isolated from the existing server and chat routes. It creates or receives a Margin Core store, creates Pi Session A, exercises the adapter to establish project continuity state, opens Session B, invokes the planner, and supplies the resulting context package before the continuation prompt.

The deterministic harness may use a fake Session boundary for repeatable tests. The optional live smoke path uses the pinned Pi version, the existing isolated resource policy, no built-in high-risk tools, and the configured YAPI provider.

## Data flow

1. The host creates a default-off Margin Core instance and a Pi Session.
2. Pi invokes an adapter tool.
3. The adapter adds host-owned permission and provenance context.
4. Margin Core validates, writes atomically where applicable, and returns a stable result envelope.
5. Before a new Session continuation, the harness reads the current project snapshot and confirmed recall candidates.
6. The planner creates a source-addressable context package.
7. Session B receives the package as explicit continuation context.
8. Lightweight trace evidence records IDs, versions, hashes, selection reasons, tool result codes, and Session relationships.

The trace excludes API keys, raw provider errors, full prompts, and full sensitive memory contents.

## Stable boundaries

- Margin Core remains the authority for state, memory, permissions, confirmations, versions, events, and audits.
- Pi remains the authority for its agent loop, messages, Session files, branching, tool execution lifecycle, and compaction.
- The adapter is a translation layer only.
- The planner is a read-only selection layer only.
- Saving does not imply recall, and recall does not imply automatic display.
- No relevant memory produces an explicit empty result.
- Existing production chat behavior remains unchanged because Stage 3 is not wired into `server.js` or chat routes.

## Error handling

The adapter exposes only stable Core result codes and bounded identifiers. Provider exceptions, SQLite messages, raw SQL, credentials, and full memory contents do not enter tool error text.

If host context is missing, permission defaults to deny. If an external-write or high-risk confirmation is absent, forged, mismatched, or replayed, the Core confirmation gate remains authoritative. Planner input with cross-project entities is rejected rather than mixed.

The live smoke path classifies missing credentials, unavailable models, provider failure, adapter failure, and continuity failure without copying upstream exception text into durable evidence.

## MVP verification

Stage 3 acceptance is intentionally narrow:

- Pi can register and invoke all four Margin Core tools through the adapter;
- Session B can receive project, active-task, decision, and relevant-memory context originating from Session A;
- planner output is deterministic, bounded, and source-addressable;
- permission denial, confirmation gating, and explicit empty recall remain effective;
- existing chat, legacy storage, and Stage 1 fixtures remain unchanged;
- the optional YAPI live smoke can demonstrate one real Session A to Session B path when credentials and provider availability permit.

Testing focuses on these key paths. Exhaustive budget simulations, complete failure matrices, task-success metrics, recall metrics, and user-outcome validation are deferred until usage produces concrete failure cases.

## Lightweight evidence

The continuity trace records:

- run ID and timestamp;
- Pi package version and model/provider identifiers;
- Session A and Session B opaque IDs;
- project/task/entity IDs and versions;
- selected and excluded context item IDs with reason codes;
- tool names, stable result codes, and audit IDs;
- a digest of the context package.

It does not become product analytics and must not be presented as user validation.

## Completion boundary

Stage 3 is complete when the isolated adapter, planner, continuity harness, key-path tests, and audit note exist behind the existing default-off boundary, and one optional live smoke command is available. Production activation and broader validation require a later explicit decision informed by real usage.
