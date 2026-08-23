# Terminal continuity pilot report

Date: 2026-08-23

Status: automated implementation verification complete; hands-on provider run recorded separately when executed.

## Implemented boundary

The terminal pilot supports one local `career_project` for resume delivery and job-application tracking. Natural-language messages use an adapter-neutral controller. The first runtime adapter uses Pi and registers exactly `memory_search`, `memory_propose`, `state_update`, and `action_update`.

The slash commands are `/state`, `/memory`, `/new`, and `/exit`. `/new` closes the current Pi Session, creates a distinct Session, delivers a fresh bounded Margin context, and asks for the current status and next step.

## Safety boundary

Pi built-in file, command, edit, and write tools are disabled. Project extensions, skills, prompts, themes, and context files remain disabled. The pilot does not access recruitment sites, email, external accounts, or arbitrary local files and cannot submit applications or send messages.

Pilot state is isolated under `data/terminal-pilot/`. Reports contain only project/Session identifiers, context digests, four fixed tool names, result codes, and safety booleans. Credentials, full prompts, conversation text, assistant text, and model reasoning are excluded.

## Automated evidence

- terminal parser and bounded provenance formatters;
- controller project creation/resume, Session replacement, model-free inspection commands, sanitized errors, and idempotent closure;
- restricted Pi resources, exact tool allowlist, host-owned invocation context, and unexpected-tool rejection;
- CLI local-only disclosure, exit behavior, and sanitized report schema;
- full repository regression, Stage 1 fixture validation, Pi baseline audit, and diff checks.

## Credential-gated hands-on run

A YAPI-backed `gpt-5.6-terra` run completed on 2026-08-23 using the API key from the Windows user environment without writing the credential to the repository or report.

- project: `931a8a49-ebae-491b-8c2a-cb93fb6b8012`;
- Session A: `01a02d95-e261-7a12-9677-06e417fea230`;
- Session B after `/new`: `01a02d95-f556-70cb-98f7-742eb84a80be`;
- context digest: `c281b98ecbe4f04bc4611c7469304c384decf78f467dc02124bb9e733d9f0dbc`;
- registered tools: exactly the four Margin tools;
- recorded result code: `allowed`;
- safety flags: local-only, built-in tools disabled, external writes disabled.

The run used read-only user instructions. Session B described the same active job-application task and next step after the Session boundary. This is a single technical smoke result, not a continuity success-rate or memory-quality measurement.

## Claim boundary

Passing tests show implementation behavior only. A hands-on run shows technical operability only. Neither establishes task success rate, recall quality, reliability, market need, adoption, or user value.

## Later technical evaluation

Pi Agent, DeepSeek Harness, and the Codex open-source project will be evaluated later using frozen repositories/versions and the same scenario. Dimensions include integration effort, Session/compaction support, tool governance, permission isolation, observability, provider compatibility, maintenance risk, Margin Core portability, and observed continuity behavior.
