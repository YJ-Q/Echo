# Terminal continuity pilot design

## Purpose

Build a small, local terminal pilot that tests one question: after interrupting a resume/job-application workflow and starting a new Agent Session, can the user resume with less repeated background and a correct next step?

This pilot is intentionally disposable and adapter-oriented. Pi is the first runtime used for evidence, not a permanent architecture commitment. After the pilot, Pi Agent, DeepSeek Harness, and the Codex open-source project will be assessed against the same task and evidence boundary.

## Scope

The pilot supports one local project representing resume delivery and job-application tracking. The user can describe jobs, application status, blockers, decisions, deadlines, and next actions in natural language.

The pilot does not read arbitrary files, access recruitment sites or email, submit applications, send messages, import prior records, schedule reminders, serve a frontend, or support multiple users. It must not activate the legacy production `/chat` path.

## Architecture

The implementation has three narrow boundaries:

1. A terminal shell owns input/output, slash commands, and graceful shutdown.
2. A pilot controller owns project selection, Session creation/replacement, context assembly, and sanitized trace reporting.
3. A runtime adapter owns model interaction. The first adapter uses the existing Pi integration and exposes exactly Margin's four governed tools.

The terminal and controller must not import Pi-specific UI types. Runtime-specific behavior stays behind an interface so a later technical evaluation can replace Pi without rewriting the pilot workflow or local data.

The pilot uses a separate local SQLite database under ignored pilot data. It does not mutate the legacy Margin database or import real historical records.

## Interaction

Natural language is the primary interaction. The terminal additionally supports:

- `/state` — show the current project, active task, blockers, decisions, and open actions with identifiers and versions;
- `/memory` — show recalled memories, selection reason, source Session, confirmation state, and version;
- `/new` — close the current Agent Session and create a distinct Session while retaining the selected project;
- `/exit` — close the Session and database cleanly.

On startup, the pilot creates or resumes one local job-application project. Before each model turn, the controller assembles bounded context from current project state, active work, confirmed decisions, relevant memories, and recent necessary dialogue. It supplies exactly the four Margin tools: `memory_search`, `memory_propose`, `state_update`, and `action_update`.

Tool results are shown as short confirmations. Full prompts, model reasoning, credentials, and sensitive raw data are not written to the pilot report.

## Memory and permissions

Ordinary conversation does not automatically become durable memory. `memory_propose` creates a candidate; sensitive or durable information remains unconfirmed until the user explicitly approves it through the existing host-controlled confirmation path.

No Pi built-in file, command, edit, write, or broad network tool is enabled. Model-provider access is the only network activity. The four Margin tools are scoped to the selected project and preserve audit evidence.

No relevant recall produces an explicit empty result. Stale versions, project mismatches, conflicts, invalid transitions, or forged confirmations are rejected rather than silently applied.

## Failure behavior

Model or provider failure leaves committed state unchanged and returns a retryable terminal error. Tool validation failures return stable non-retryable messages. Storage failures return retryable errors and retain audit evidence where the storage transaction permits it.

`Ctrl+C` and `/exit` attempt orderly Session and database closure. An incomplete model turn must not be represented as a completed action or confirmed memory.

## Minimal verification

Automated checks cover:

- slash-command parsing and output boundaries;
- terminal controller behavior without requiring paid model calls;
- distinct Session identifiers across `/new`;
- delivery of current state and provenance into the new Session;
- create, complete, and revoke action flows;
- explicit empty memory recall;
- conflict, stale version, and sensitive-memory gates;
- absence of Pi built-in high-risk tools;
- sanitized trace/report output and graceful shutdown.

One credential-gated manual run uses the configured real model. It records Session boundaries, context digest, registered tool names, result codes, and safety checks. It does not claim task success rate, memory quality, market demand, or user validation.

## Exit criteria

The pilot is ready for hands-on use when a user can record a job-application action, start a distinct new Session with `/new`, receive the current status and next step with source provenance, complete or revoke the action, inspect state/memory, and exit without data corruption.

## Later runtime evaluation

The later comparison will reuse the pilot scenario and evidence format. It will assess Pi Agent, DeepSeek Harness, and the Codex open-source project on integration effort, Session and compaction support, tool governance, permission isolation, observability, provider compatibility, maintenance risk, portability of Margin Core, and observed continuity behavior. Exact repositories, versions, licenses, and test controls will be frozen only when that evaluation begins.
