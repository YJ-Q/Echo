# Margin Implementation Roadmap

Date: 2026-07-10

## Product Direction

Margin uses one Express backend, one React/Vite frontend, and one Electron desktop shell. The interface follows the uploaded paper-notebook reference while treating it as layered desk paper rather than a literal open book. The homepage divider is the left-edge shadow of an independent vellum learning sheet.

## Completed In The React Migration

- Serve `frontend/dist` as the only product UI and remove the obsolete `public/` fallback.
- Replace Stitch sample state and damaged seed copy with real API-backed data.
- Use a generated photorealistic notebook shell for paper, page edges, binding, tabs, and ribbon while keeping interactive content in React.
- Connect chat, state, learning, memory, achievements, actions, summaries, management proposals, and optional TTS.
- Keep management changes behind draft and confirmation steps.
- Lock the Electron window to a 4:3 aspect ratio and manage the backend process lifecycle.
- Prevent unrelated casual chat from mutating an active learning line.
- Normalize broad English learning prompts to a clean topic.
- Verify the production UI at the desktop viewport and run the complete automated test suite.
- Move Echo-era UI specifications and mock data into `docs/archive/echo-era/`.
- Migrate user-facing names, prompts, configuration, launchers, and desktop bridges to Margin while retaining safe data aliases.
- Align the interactive left tabs to the tab positions baked into the notebook material.

## Completed In The Approved Blueprint Execution

- Replace the fourth "+" tab with a dedicated Settings paper and remove decorative moon/settings icons from the homepage.
- Persist first-install light reading as off and remember later choices.
- Add Electron `safeStorage` key storage, masked renderer snapshots, provider/model settings, backend restart, and rollback to the previous encrypted configuration on startup failure.
- Separate conversation and speech providers, add SiliconFlow TTS and cloud STT adapters, and keep microphone transcription editable and non-sending.
- Replace the disabled microphone placeholder with explicit recording, transcribing, permission, and error states.
- Split homepage vellum, Learning Track drafting paper, Traces cotton paper, organization ledger paper, and Settings note paper into independent generated assets.
- Remove the always-visible learning line from non-home pages and give Learning Track, Traces, and Settings full-page layouts.
- Add contextual organization entry points and an in-page confirmation sheet; remove native `window.confirm` and `window.prompt` flows.
- Restrict management suggestions and drafts to operations the executor can actually perform.
- Persist imprint definitions and first unlock events, add one-time acknowledgement, backup coverage, and a complete Traces → Imprints collection page.
- Add the four Traces views: recent, retained, long-term profile, and imprints.
- Connect memory retention, softening, profile refresh, and direct profile correction without exposing confidence values.
- Make learning history read-only and expose one explicit completion action only for the current step.

## Next Execution Order

### P1 - Release Readiness

1. Add Electron packaging, application icons, version metadata, and a Windows installer.
2. Add React component tests for navigation, recorder state, settings forms, profile correction, and capability-gated controls.
3. Add screenshot baselines for tab alignment, page materials, organization confirmation, imprints, and reduced motion.
4. Complete a packaged-desktop smoke test for encrypted settings, backend restart, microphone permission, and exact 4:3 ratio.

### P2 - Data Quality

1. Back up the local database before any migration.
2. Build a preview-only report for early records containing repeated `?` characters.
3. Ask for explicit approval before repairing or archiving those records.
4. Extend management merge candidates with every related target id so merge proposals can be formed without inference in the frontend.

### P3 - Optional Product Expansion

1. Persist user-created notebook sections in the backend instead of browser storage.
2. Add additional speech adapters without changing the recording interaction.
3. Add configurable paper themes without changing the core notebook information architecture.

## Acceptance Gate

A release candidate should pass all of the following:

- `npm run lint:ui`
- `npm run build:ui`
- `npm test`
- browser verification at `960x720`
- Electron launch, backend health, and exact 4:3 window-ratio verification
- backup and restore smoke test before any data migration
