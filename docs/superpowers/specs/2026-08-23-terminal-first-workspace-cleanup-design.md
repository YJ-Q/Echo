# Terminal-first workspace cleanup design

## Decision

Margin will use Pi's terminal runtime for the next product pilot. The repository will not maintain the old Electron/static web interface while the continuity MVP is being validated.

Pi supplies an agent runtime, terminal UI, SDK, RPC mode, sessions, branching, and context compaction. The pinned Pi package does not supply a reusable ChatGPT-style desktop web interface. A future Margin interface must therefore be designed against Margin Core's stable contracts rather than treated as a skin over an existing Pi desktop application.

## Scope

Delete now:

- `public/` and `electron/`;
- desktop launchers and Electron package configuration;
- frontend-specific documents and mock payloads;
- the obsolete UI-centred case-study site, screenshots, generated PDFs, build scripts, and tests;
- tests whose only purpose is to enforce the deleted interface or case-study assets.

Keep now:

- `src/core/`, `src/continuity/`, and `src/runtime/pi/`;
- Pi spike, continuity smoke, frozen evaluation fixtures, audit reports, and current architecture records;
- legacy API routes, services, and storage temporarily, so terminal work does not destroy migration paths or existing data access;
- all real databases, exports, and backups.

## Runtime after cleanup

`npm start` remains an API-only compatibility runtime. It must not serve static files or claim to include a desktop-style frontend. Pi terminal and continuity smoke commands remain the primary validation path. A dedicated interactive Margin terminal workflow is a subsequent feature, not part of this cleanup.

## Safety and verification

The cleanup must not recursively delete broad or computed paths. Every deleted tracked path is explicit. Before deletion, tests will assert that package metadata and the Express application no longer expose frontend/Electron behavior; these tests should fail against the current tree. After implementation, the focused cleanup test, the full Node test suite, Stage 1 fixture validation, Pi audit, and repository diff checks will run. Tests tied solely to intentionally removed artifacts are removed with those artifacts.

## Deferred second cleanup

Legacy routes, services, and `src/storage/memoryStore.js` will be reviewed only after the terminal MVP can create and resume projects, inspect provenance, and update tasks/actions using Margin Core. That later review will explicitly migrate or archive data before deleting compatibility code.
